/**
 * Migration RH V2 — reprend TOUTE la donnée RH historique d'AppSetting (KV) vers
 * les nouvelles tables relationnelles, SANS PERTE. Idempotent (upsert par clé
 * naturelle) et re-jouable. Les clés KV d'origine sont CONSERVÉES (rollback).
 *
 *   npx tsx scripts/rh-migrate-kv.ts --dry     # compte, n'écrit rien
 *   npx tsx scripts/rh-migrate-kv.ts           # applique
 *
 * S'appuie sur les LECTEURS EXISTANTS (parseurs testés) : lib/heuresRh,
 * lib/congesRh, lib/salairesRh. Le JSON d'origine est stocké tel quel dans les
 * colonnes JSON (days/validationData/meta/history) → fidélité totale, même si un
 * mapping de champ est affiné plus tard. Voir plan rh-refonte.md.
 *
 * Prérequis : le SQL additif (deploy/sql/rh-v2-schema.sql) doit être appliqué sur
 * la base cible AVANT de lancer ce script.
 */
import { prisma } from "@/lib/prisma";
import { listProfiles, listAllWeekEntries } from "@/lib/heuresRh";
import { listAllConges, getCongeJustificatif } from "@/lib/congesRh";
import {
  listSalaryProfiles, listSalaryMonths, listEnvois, listAllRecupPayouts,
} from "@/lib/salairesRh";
import { monthIdOf, shiftMonth } from "@/lib/heuresCalc";

const DRY = process.argv.includes("--dry");
const log = (...a: unknown[]) => console.log(DRY ? "[DRY]" : "[MIG]", ...a);

async function ensureEmployee(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const existing = await prisma.employee.findUnique({ where: { email: e }, select: { id: true } });
  if (existing) return existing.id;
  // Lien compte d'auth + commercial SAP (via User / UserCommercial) si présents.
  const user = await prisma.user.findFirst({ where: { email: { equals: e, mode: "insensitive" } }, select: { id: true, name: true } });
  let sapSlpName: string | null = null;
  try {
    const uc = await prisma.$queryRawUnsafe<{ slpName: string }[]>(
      `SELECT "slpName" FROM "UserCommercial" WHERE LOWER("email") = $1 LIMIT 1`, e,
    );
    sapSlpName = uc[0]?.slpName ?? null;
  } catch { /* table absente → ignore */ }
  if (DRY) { log("employee +", e, user ? "(user lié)" : "", sapSlpName ? `(SAP ${sapSlpName})` : ""); return "dry"; }
  const created = await prisma.employee.create({
    data: { email: e, userId: user?.id ?? null, displayName: user?.name ?? null, sapSlpName, statutEmploi: "actif" },
    select: { id: true },
  });
  return created.id;
}

async function main() {
  const stats: Record<string, number> = {};
  const bump = (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };

  // 1) Rassembler tous les emails RH (profils heures + salaires + congés + semaines).
  const [profiles, salProfiles, allWeeks, allConges] = await Promise.all([
    listProfiles(), listSalaryProfiles(), listAllWeekEntries(), listAllConges(),
  ]);
  const emails = new Set<string>();
  for (const e of profiles.keys()) emails.add(e.toLowerCase());
  for (const e of salProfiles.keys()) emails.add(e.toLowerCase());
  for (const e of allWeeks.keys()) emails.add(e.toLowerCase());
  for (const c of allConges) emails.add(c.email.toLowerCase());
  log(`emails RH distincts : ${emails.size}`);

  const empId = new Map<string, string>();
  for (const e of emails) { empId.set(e, await ensureEmployee(e)); bump("employees"); }

  // 2) Profil → Contrat (heures) + solde initial (CP/récup cap).
  for (const [email, p] of profiles) {
    const id = empId.get(email.toLowerCase()); if (!id) continue;
    if (!DRY) {
      // Contrat actif (upsert « logique » : un seul contrat de reprise par salarié).
      const has = await prisma.contract.findFirst({ where: { employeeId: id, motif: "reprise-kv" }, select: { id: true } });
      if (!has) {
        await prisma.contract.create({ data: {
          employeeId: id, type: "CDI", statut: "actif", dateDebut: new Date("2020-01-01"),
          heuresHebdo: p.weeklyHours ?? 35, heuresAnnuelles: 1600, motif: "reprise-kv",
        }});
      }
      await prisma.rhLeaveBalance.upsert({
        where: { employeeId_periodeRef: { employeeId: id, periodeRef: "reprise" } },
        create: { employeeId: id, periodeRef: "reprise", cpSolde: p.cpAnchorDays ?? p.cpAllowanceDays ?? 0, recupCapMin: Math.round((p.recupCapHours ?? 0) * 60) },
        update: { recupCapMin: Math.round((p.recupCapHours ?? 0) * 60) },
      });
    }
    bump("contracts");
  }

  // 3) Semaines → RhWeekSheet (JSON days/validation conservés).
  for (const [email, weeks] of allWeeks) {
    const id = empId.get(email.toLowerCase()); if (!id) continue;
    for (const [isoWeek, entry] of weeks) {
      if (!DRY) {
        await prisma.rhWeekSheet.upsert({
          where: { employeeId_isoWeek: { employeeId: id, isoWeek } },
          create: {
            employeeId: id, isoWeek,
            option: (entry as { option?: string }).option ?? null,
            paySuppMin: (entry as { paySuppMin?: number }).paySuppMin ?? 0,
            days: JSON.stringify((entry as { days?: unknown }).days ?? []),
            updatedBy: (entry as { updatedBy?: string }).updatedBy ?? null,
          },
          update: { days: JSON.stringify((entry as { days?: unknown }).days ?? []) },
        });
      }
      bump("weeksheets");
    }
  }

  // 4) Congés → RhLeaveRequest (+ justificatif → RhDocument).
  for (const c of allConges) {
    const id = empId.get(c.email.toLowerCase()); if (!id) continue;
    if (!DRY) {
      await prisma.rhLeaveRequest.upsert({
        where: { id: `kv_${c.email}_${c.id}`.slice(0, 190) },
        create: {
          id: `kv_${c.email}_${c.id}`.slice(0, 190), employeeId: id,
          type: c.type, statut: c.status, startDate: new Date(c.start), endDate: new Date(c.end),
          origin: (c as { origin?: string }).origin ?? "salarie", note: (c as { note?: string }).note ?? null,
          decisionNote: (c as { decisionNote?: string }).decisionNote ?? null,
          justified: (c as { justified?: boolean }).justified ?? false,
          history: JSON.stringify(c),
        },
        update: { statut: c.status, history: JSON.stringify(c) },
      });
      const justif = await getCongeJustificatif(c.email, c.id).catch(() => null);
      if (justif) {
        await prisma.rhDocument.upsert({
          where: { id: `kvjustif_${c.email}_${c.id}`.slice(0, 190) },
          create: { id: `kvjustif_${c.email}_${c.id}`.slice(0, 190), employeeId: id, type: "justificatif", nom: `Justificatif ${c.id}`, contenu: justif },
          update: {},
        });
        bump("documents");
      }
    }
    bump("leaves");
  }

  // 5) Éléments de salaire (12 derniers mois) → RhPayrollElement.
  const months: string[] = [];
  let m = monthIdOf(new Date());
  for (let i = 0; i < 18; i++) { months.push(m); m = shiftMonth(m, -1); }
  for (const monthId of months) {
    const rows = await listSalaryMonths(monthId).catch(() => new Map());
    for (const [email, data] of rows) {
      const id = empId.get(email.toLowerCase()); if (!id) continue;
      const d = data as { primes?: { id: string; label?: string; montant?: number }[]; frais?: { id: string; label?: string; montant?: number }[] };
      for (const pr of d.primes ?? []) {
        if (!DRY) await prisma.rhPayrollElement.upsert({
          where: { id: `kvprime_${email}_${monthId}_${pr.id}`.slice(0, 190) },
          create: { id: `kvprime_${email}_${monthId}_${pr.id}`.slice(0, 190), employeeId: id, mois: monthId, type: "prime", label: pr.label ?? null, montant: pr.montant ?? 0 },
          update: { montant: pr.montant ?? 0 },
        });
        bump("payElements");
      }
      for (const fr of d.frais ?? []) {
        if (!DRY) await prisma.rhPayrollElement.upsert({
          where: { id: `kvfrais_${email}_${monthId}_${fr.id}`.slice(0, 190) },
          create: { id: `kvfrais_${email}_${monthId}_${fr.id}`.slice(0, 190), employeeId: id, mois: monthId, type: "frais", label: fr.label ?? null, montant: fr.montant ?? 0 },
          update: { montant: fr.montant ?? 0 },
        });
        bump("payElements");
      }
    }
  }

  // 6) Récup payées → RhPayrollElement (type recup_paye).
  const recups = await listAllRecupPayouts().catch(() => new Map());
  for (const [email, list] of recups) {
    const id = empId.get(email.toLowerCase()); if (!id) continue;
    for (const rp of list as { id: string; monthBulletin?: string; majMin?: number; note?: string }[]) {
      if (!DRY) await prisma.rhPayrollElement.upsert({
        where: { id: `kvrecup_${email}_${rp.id}`.slice(0, 190) },
        create: { id: `kvrecup_${email}_${rp.id}`.slice(0, 190), employeeId: id, mois: rp.monthBulletin ?? monthIdOf(new Date()), type: "recup_paye", montant: 0, meta: JSON.stringify(rp) },
        update: { meta: JSON.stringify(rp) },
      });
      bump("payElements");
    }
  }

  // 7) Envois compta → RhPayrollSend.
  const envois = await listEnvois().catch(() => []);
  for (const en of envois as { id: string; monthId?: string; kind?: string; filename?: string; to?: string[]; sentBy?: string; sentAt?: string }[]) {
    if (!DRY) await prisma.rhPayrollSend.upsert({
      where: { id: `kvenvoi_${en.id}`.slice(0, 190) },
      create: { id: `kvenvoi_${en.id}`.slice(0, 190), mois: en.monthId ?? "", kind: en.kind ?? "normal", filename: en.filename ?? null, to: JSON.stringify(en.to ?? []), sentBy: en.sentBy ?? null, sentAt: en.sentAt ? new Date(en.sentAt) : new Date() },
      update: {},
    });
    bump("payrollSends");
  }

  // 8) JOURNAL : backfill d'évènements (embauche + contrats + congés) pour que la
  //    fiche salarié affiche l'historique. Idempotent (id déterministe).
  const allEmps = await prisma.employee.findMany({ select: { id: true, hireDate: true, contracts: { select: { id: true, type: true, dateDebut: true } }, leaves: { select: { id: true, type: true, startDate: true, endDate: true, jours: true } } } });
  for (const e of allEmps) {
    if (!DRY && e.hireDate) {
      await prisma.rhEvent.upsert({ where: { id: `kvevt_hire_${e.id}`.slice(0, 190) }, create: { id: `kvevt_hire_${e.id}`.slice(0, 190), employeeId: e.id, type: "embauche", date: e.hireDate }, update: {} });
      bump("events");
    }
    for (const c of e.contracts) {
      if (!DRY) await prisma.rhEvent.upsert({ where: { id: `kvevt_ct_${c.id}`.slice(0, 190) }, create: { id: `kvevt_ct_${c.id}`.slice(0, 190), employeeId: e.id, type: "contrat", date: c.dateDebut, meta: JSON.stringify({ contractType: c.type }) }, update: {} });
      bump("events");
    }
    for (const l of e.leaves) {
      if (!DRY) await prisma.rhEvent.upsert({ where: { id: `kvevt_lv_${l.id}`.slice(0, 190) }, create: { id: `kvevt_lv_${l.id}`.slice(0, 190), employeeId: e.id, type: "absence", date: l.startDate, meta: JSON.stringify({ leaveType: l.type, jours: l.jours, start: l.startDate.toISOString(), end: l.endDate.toISOString() }) }, update: { meta: JSON.stringify({ leaveType: l.type, jours: l.jours, start: l.startDate.toISOString(), end: l.endDate.toISOString() }) } });
      bump("events");
    }
  }

  log("terminé.", stats);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
