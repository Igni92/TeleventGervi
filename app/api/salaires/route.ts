import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isGerantEmail } from "@/lib/permissions";
import {
  computeWeek, typicalDayMinutes, isMonthId, monthIdOf, monthWeeks, weekDates,
  splitSupp, effectivePaySuppMin, splitStructuralSupp, structuralSuppMin,
  type HoursProfile,
} from "@/lib/heuresCalc";
import { listAllWeekEntries, listProfiles, getProfile, getWeekEntry, saveWeekEntry, type WeekEntry } from "@/lib/heuresRh";
import { listAllConges } from "@/lib/congesRh";
import { expandOuvrables, monthEndISO } from "@/lib/planning";
import { rangesOverlap, type CongeRequest } from "@/lib/conges";
import { stripOrgSuffix } from "@/lib/userNames";
import {
  avantageNatureMensuel, missingElements, prorata13e, recapMailHtml, salaireMonthLabel,
  type RecapRow, type SalaryHeures, type SalaryMonthData, type SalaryPrime,
} from "@/lib/salaires";
import { commissionsOfMonthByEmail, COMMISSION_PRIME_ID } from "@/lib/commissions";
import {
  saveSalaryMonth, listSalaryMonths,
  saveSalaryProfile, listSalaryProfiles,
  getRecapSent, markRecapSent,
  getComptaEmails, setComptaEmails, listEnvois, logEnvoi,
} from "@/lib/salairesRh";
import { appBaseUrl } from "@/lib/congesNotify";
import { sendMailAsShared } from "@/lib/graph";

export const dynamic = "force-dynamic";

/**
 * ÉLÉMENTS DES SALAIRES (onglet /salaires) — remplace l'envoi du PDF compta.
 *
 *   GET  ?month=YYYY-MM            → une ligne par salarié : heures du mois
 *                                    (travaillées, supp payées/récup décidées,
 *                                    CP, absences, fériés), primes + frais
 *                                    saisis, fiche paie (CDI, 13e, véhicule AN),
 *                                    éléments manquants — admin/direction ET
 *                                    profil COMPTABLE (lecture).
 *   POST { month, user, primes, frais, note } → enregistre les éléments du mois
 *   POST { action:"send", month }  → envoie le RÉCAP email au cabinet comptable
 *   PUT  { user, profile }         → fiche paie (date CDI, 13e mois, véhicule)
 *
 * Écritures réservées aux managers (admin/direction) ; le comptable LIT.
 */

async function ctx() {
  const session = await auth();
  if (!session?.user) return null;
  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) return null;
  const canEdit = await requireAdmin(session);
  return { email, canEdit };
}

/** Résumé HEURES d'un salarié pour le mois (mêmes règles que l'état mensuel :
 *  semaines rattachées au mois de leur dimanche, majorations hebdomadaires). */
function buildHeures(
  weekIds: string[],
  entries: Map<string, WeekEntry> | undefined,
  profile: HoursProfile,
  conges: CongeRequest[],
  monthId: string,
): SalaryHeures {
  const typDay = typicalDayMinutes(profile);
  const out: SalaryHeures = {
    totalMin: 0, contractMin: 0, suppTotalMin: 0, suppPayEquivMin: 0, suppRecupEquivMin: 0, suppSansDecisionMin: 0,
    ferieMin: 0, congesMin: 0, cpJours: 0, maladieJours: 0, absentJours: 0, recupJours: 0,
    weeksWithData: 0, weeksTotal: weekIds.length,
  };
  // Dates de RÉCUP prise (repos) — dédupliquées : feuille (tag « récup ») + jours
  // des congés RÉCUP validés (l'auto-répartition récup→CP inscrit la récup en
  // congé, pas en tag). La récup est prioritaire sur les CP → ces jours partent
  // en récup, et le détail (récup vs CP) apparaît ainsi sur le document compta.
  const recupDates = new Set<string>();
  for (const w of weekIds) {
    const e = entries?.get(w);
    if (!e) continue;
    out.weeksWithData += 1;
    const c = computeWeek(e.days, profile.weeklyHours, typDay);
    out.totalMin += c.totalMin;
    out.contractMin += c.contractMin;
    out.ferieMin += c.ferieMin;
    out.congesMin += c.congesMin;
    const supp = c.sup25Min + c.sup50Min;
    if (supp > 0) {
      out.suppTotalMin += supp;
      // Heures supp STRUCTURELLES (contrat « 42 h ») : payées d'office, jamais
      // arbitrées ni comptées « sans décision ». Seul le dépassement au-delà de
      // `paidWeeklyHours` part au choix récup/paiement.
      const st = splitStructuralSupp(c.sup25Min, c.sup50Min, structuralSuppMin(profile));
      out.suppPayEquivMin += st.structEquivMin;
      const arbitrable = st.arbitrableMin;
      if (arbitrable > 0) {
        if (e.option) {
          const pay = effectivePaySuppMin(e.option, e.paySuppMin, arbitrable);
          const s = splitSupp(st.arb25Min, st.arb50Min, pay);
          out.suppPayEquivMin += s.payEquivMin;
          out.suppRecupEquivMin += s.recupEquivMin;
        } else {
          out.suppSansDecisionMin += arbitrable;
        }
      }
    }
    const wDates = weekDates(w);
    e.days.forEach((d, i) => {
      if (d?.tag === "maladie") out.maladieJours += 1;
      else if (d?.tag === "absent") out.absentJours += 1;
      else if (d?.tag === "recup" && wDates[i]) recupDates.add(wDates[i]);
    });
  }
  // CP + RÉCUP VALIDÉS tombant dans le mois civil (jours ouvrables, hors dim./fériés).
  const a = `${monthId}-01`, b = monthEndISO(monthId);
  for (const g of conges) {
    if (g.status !== "approved" || !rangesOverlap(g.start, g.end, a, b)) continue;
    const from = g.start > a ? g.start : a, to = g.end < b ? g.end : b;
    if (g.type === "cp") out.cpJours += expandOuvrables(from, to).length;
    else if (g.type === "recup") for (const dte of expandOuvrables(from, to)) recupDates.add(dte);
  }
  out.recupJours = recupDates.size;
  return out;
}

/** Construit toutes les lignes du mois (partagé GET / envoi du récap). */
async function buildRows(monthId: string) {
  const weeks = monthWeeks(monthId);
  const [users, byUser, hourProfiles, salProfiles, salMonths, allConges, commissions] = await Promise.all([
    prisma.user.findMany({ select: { name: true, email: true }, orderBy: { name: "asc" } }),
    listAllWeekEntries(),
    listProfiles(),
    listSalaryProfiles(),
    listSalaryMonths(monthId),
    listAllConges(),
    // COMMISSIONS DU MOIS par salarié — payées « au fur et à mesure » : ligne
    // de prime AUTOMATIQUE (jamais persistée, recalculée à chaque lecture).
    commissionsOfMonthByEmail(monthId),
  ]);
  const congesByUser = new Map<string, CongeRequest[]>();
  for (const g of allConges) {
    const list = congesByUser.get(g.email);
    if (list) list.push(g); else congesByUser.set(g.email, [g]);
  }
  const seen = new Set<string>();
  /** Injecte la ligne de prime COMMISSIONS du mois (id réservé, `auto`) :
   *  toute version persistée est d'abord retirée (la ligne n'est jamais
   *  falsifiable — elle suit le calcul, « au fur et à mesure que ça arrive »). */
  const withCommission = (email: string, salary: SalaryMonthData | null): SalaryMonthData | null => {
    const com = commissions.get(email);
    const primes = (salary?.primes ?? []).filter((p) => p.id !== COMMISSION_PRIME_ID);
    if (!com) return salary ? { ...salary, primes } : null;
    const line: SalaryPrime = {
      id: COMMISSION_PRIME_ID,
      motif: `Commissions ventes (${(com.rate * 100).toFixed(0)} % marge nette)`,
      montant: com.prime,
      bulletinDe: monthId,
      note: `Base retenue du mois ${com.base.toFixed(2)} € — calcul automatique, détail dans Pilotage › Commerciaux`,
      auto: true,
    };
    return salary
      ? { ...salary, primes: [line, ...primes] }
      : { primes: [line], frais: [], updatedAt: "", updatedBy: "auto" };
  };

  const build = (email: string, rawName: string) => {
    const hourProfile = hourProfiles.get(email) ?? { weeklyHours: 35, typicalDay: { m1: "06:00", m2: "13:00" } };
    const salProfile = salProfiles.get(email) ?? null;
    const salary = withCommission(email, salMonths.get(email) ?? null);
    const heures = buildHeures(weeks, byUser.get(email), hourProfile, congesByUser.get(email) ?? [], monthId);
    const anMensuel = avantageNatureMensuel(salProfile?.vehicule);
    return {
      email,
      name: stripOrgSuffix(rawName) || email,
      heures,
      salary,
      profile: salProfile,
      anMensuel,
      prorata13: prorata13e(salProfile?.cdiDate, monthId),
      missing: missingElements(monthId, salProfile, salary, heures),
    };
  };
  const rows = (users as { name: string | null; email: string | null }[])
    .filter((u) => u.email)
    .map((u) => {
      const email = u.email!.trim().toLowerCase();
      seen.add(email);
      return build(email, u.name || email);
    });
  // Saisies orphelines (compte supprimé mais heures présentes) : visibles quand
  // même — la paie du mois les concerne encore.
  for (const [email] of byUser) {
    if (!seen.has(email)) rows.push(build(email, email));
  }
  // GÉRANTS : ils saisissent leurs heures mais n'ont pas de bulletin → exclus des
  // éléments des salaires (saisie, état comptable PDF, récap email).
  return rows.filter((r) => !isGerantEmail(r.email));
}

export async function GET(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!c.canEdit) return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? monthIdOf(new Date());
  if (!isMonthId(month)) return NextResponse.json({ error: "Mois invalide" }, { status: 400 });

  try {
    const [rows, sent, comptaEmails, envois] = await Promise.all([
      buildRows(month), getRecapSent(month), getComptaEmails(), listEnvois(),
    ]);
    return NextResponse.json({ ok: true, month, rows, sent, canEdit: c.canEdit, comptaEmails, envois });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!c.canEdit) return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });

  let body: {
    action?: string; month?: string; user?: string; primes?: unknown; frais?: unknown; note?: unknown;
    mode?: string; payMin?: unknown; pdfBase64?: unknown; kind?: string; emails?: unknown;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  // ── Destinataires du cabinet comptable (réglage UI, sans mois) ──
  if (body.action === "setComptaEmails") {
    try {
      const emails = await setComptaEmails(body.emails);
      return NextResponse.json({ ok: true, comptaEmails: emails });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  const month = body.month ?? "";
  if (!isMonthId(month)) return NextResponse.json({ error: "Mois invalide" }, { status: 400 });

  // ── DÉCISION HEURES SUPP (payer / récup / partage) — gérée ICI, par salarié
  //    et par mois : on applique le choix à TOUTES les semaines du mois qui ont
  //    des heures supp. « pay » = tout payé, « recup » = tout en récup, « split »
  //    = payer `payMin` minutes (brutes) au total, remplies semaine par semaine
  //    (chronologique), le reste en récup. Les jours saisis ne sont PAS touchés. ──
  if (body.action === "suppDecision") {
    const target = (body.user ?? "").trim().toLowerCase();
    if (!target) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });
    const mode = body.mode;
    if (mode !== "pay" && mode !== "recup" && mode !== "split") {
      return NextResponse.json({ error: "Décision invalide" }, { status: 400 });
    }
    try {
      const profile = await getProfile(target);
      const typDay = typicalDayMinutes(profile);
      let remaining = mode === "split" ? Math.max(0, Math.round(Number(body.payMin) || 0)) : 0;
      for (const w of monthWeeks(month)) {
        const entry = await getWeekEntry(target, w);
        if (!entry) continue;
        const calc = computeWeek(entry.days, profile.weeklyHours, typDay);
        // La décision ne porte que sur les heures supp ARBITRABLES : la part
        // structurelle (contrat « 42 h ») est toujours payée d'office.
        const st = splitStructuralSupp(calc.sup25Min, calc.sup50Min, structuralSuppMin(profile));
        const arbitrable = st.arbitrableMin;
        if (arbitrable <= 0) continue;
        let opt: { option: string; paySuppMin?: number; recupDates?: string[] };
        if (mode === "pay") {
          opt = { option: "paiement", recupDates: entry.recupDates };
        } else if (mode === "recup") {
          opt = { option: "recup", recupDates: entry.recupDates };
        } else {
          const assigned = Math.min(remaining, arbitrable);
          remaining -= assigned;
          opt = assigned <= 0
            ? { option: "recup", recupDates: entry.recupDates }
            : assigned >= arbitrable
              ? { option: "paiement", recupDates: entry.recupDates }
              : { option: "mixte", paySuppMin: assigned, recupDates: entry.recupDates };
        }
        await saveWeekEntry(target, w, entry.days, c.email, opt);
      }
      return NextResponse.json({ ok: true, month, user: target });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── ENVOI AU CABINET : le PDF (généré côté navigateur, base64) est joint au
  //    mail, envoyé aux destinataires configurés. Chaque envoi est journalisé
  //    (liste des documents transmis) ; `kind:"rectif"` = rectificatif. ──
  if (body.action === "send") {
    try {
      const from = process.env.CONGES_FROM_ADDRESS || process.env.RELANCE_FROM_ADDRESS;
      if (!from) return NextResponse.json({ error: "Boîte d'envoi non configurée (CONGES_FROM_ADDRESS)" }, { status: 400 });
      // Défensif : accepte le base64 pur OU une data-URI « data:…;base64,XXXX ».
      const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64.replace(/^data:[^,]*base64,/, "") : "";
      if (!pdfBase64) return NextResponse.json({ error: "PDF manquant" }, { status: 400 });
      const kind = body.kind === "rectif" ? "rectif" : "normal";

      // Destinataires : réglage UI d'abord, repli env COMPTA_EMAIL, puis défaut.
      const configured = await getComptaEmails();
      const envTo = (process.env.COMPTA_EMAIL ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      const recipients = configured.length ? configured : envTo.length ? envTo : ["compta@gervifrais.com"];

      const rows = await buildRows(month);
      const recapRows: RecapRow[] = rows
        .filter((r) => r.heures.weeksWithData > 0 || (r.salary && (r.salary.primes.length || r.salary.frais.length)))
        .map((r) => ({
          name: r.name, email: r.email, heures: r.heures, anMensuel: r.anMensuel,
          vehicule: r.profile?.vehicule ?? null,
          primes: r.salary?.primes ?? [], frais: r.salary?.frais ?? [],
          note: r.salary?.note, missing: r.missing,
        }));
      const filename = `elements-salaires-${month}.pdf`;

      await sendMailAsShared(from, {
        to: recipients,
        subject: `💶 ${kind === "rectif" ? "RECTIF · " : ""}Éléments des salaires — ${salaireMonthLabel(month)}`,
        html: recapMailHtml(month, recapRows, appBaseUrl()),
        attachments: [{ name: filename, base64: pdfBase64, contentType: "application/pdf" }],
      });
      const [sent, envoi] = await Promise.all([
        markRecapSent(month, c.email, recipients),
        logEnvoi({ monthId: month, sentBy: c.email, to: recipients, kind, filename }),
      ]);
      return NextResponse.json({ ok: true, month, sent, envoi, recipients });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── Enregistrement des éléments du mois d'UN salarié ──
  const target = (body.user ?? "").trim().toLowerCase();
  if (!target) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });
  try {
    // La ligne COMMISSIONS (id réservé) n'est JAMAIS persistée : recalculée à
    // chaque lecture — la retirer ici empêche tout doublon ou montant figé.
    const primes = Array.isArray(body.primes)
      ? (body.primes as { id?: unknown }[]).filter((p) => p?.id !== COMMISSION_PRIME_ID)
      : body.primes;
    const data = await saveSalaryMonth(target, month, { primes, frais: body.frais, note: body.note }, c.email);
    return NextResponse.json({ ok: true, month, user: target, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!c.canEdit) return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });

  let body: { user?: string; profile?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const target = (body.user ?? "").trim().toLowerCase();
  if (!target) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });
  try {
    const profile = await saveSalaryProfile(target, body.profile);
    return NextResponse.json({ ok: true, user: target, profile });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
