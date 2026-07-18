import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope, isDirection } from "@/lib/permissions";
import {
  DEFAULT_PROFILE, isMonthId, monthIdOf, typicalDayMinutes, weekDates,
  type DayTag, type HoursProfile,
} from "@/lib/heuresCalc";
import {
  getProfile, saveProfile, listProfiles,
  listUserWeekEntries, listAllWeekEntries, type WeekEntry,
} from "@/lib/heuresRh";
import { listUserConges, listAllConges } from "@/lib/congesRh";
import { rangesOverlap, type CongeRequest } from "@/lib/conges";
import {
  computeRecupCounter, computeCpCounter, cpConfigOf, recupCapExcessMin,
  expandOuvrables, isoWeekOfDate, monthGridDays, type CounterWeekInput,
} from "@/lib/planning";

export const dynamic = "force-dynamic";

/**
 * PLANNING (calendriers congés/récup + compteurs) — onglet « Planning ».
 *
 *   GET ?month=YYYY-MM   → mes données (calendrier + compteurs) ; managers :
 *                          celles de TOUTE l'équipe (1 calendrier par personne
 *                          + calendrier d'équipe côté client).
 *   PUT { user, cpAllowanceDays?, recupCapHours? }  → réglages EMPLOYEUR
 *                          (direction seule) : solde CP annuel + plafond récup.
 *
 * Compteurs calculés À LA VOLÉE depuis les saisies de semaines + congés
 * validés (lib/planning) : crédit récup = heures supp « option récup » des
 * semaines passées ; débit UNIQUEMENT au passage de la semaine (contrat
 * atteint → rien n'est déduit). Les propositions/demandes suivent le circuit
 * boomerang de /api/effectif/conges.
 */

async function ctx() {
  const session = await auth();
  if (!session?.user) return null;
  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) return null;
  const scope = await getAccessScope(session);
  return {
    email,
    name: session.user.name?.trim() || email,
    isManager: !!scope.all,
    isDir: await isDirection(session),
  };
}

/** Données planning d'UNE personne pour le mois affiché. */
function buildPerson(
  email: string,
  name: string,
  profile: HoursProfile,
  entries: Map<string, WeekEntry>,
  conges: CongeRequest[],
  monthId: string,
  todayISO: string,
) {
  const weeks: CounterWeekInput[] = [...entries.entries()].map(([week, e]) => ({
    week, days: e.days, option: e.option, paySuppMin: e.paySuppMin, recupDates: e.recupDates,
  }));
  // Jours de récup validés via le planning (boomerang) — dédupliqués dans le
  // compteur avec ceux déjà reportés dans les saisies.
  const extraRecup = conges
    .filter((c) => c.type === "recup" && c.status === "approved")
    .flatMap((c) => expandOuvrables(c.start, c.end));

  const recup = computeRecupCounter(weeks, extraRecup, profile, todayISO);
  const cp = computeCpCounter(cpConfigOf(profile), conges, todayISO);
  const capMin = profile.recupCapHours == null ? null : Math.round(profile.recupCapHours * 60);

  // Grille du mois : tags jour par jour (issus des saisies) + récup posées.
  const grid = monthGridDays(monthId);
  const gridStart = grid[0]?.date ?? `${monthId}-01`;
  const gridEnd = grid[grid.length - 1]?.date ?? `${monthId}-31`;
  const tags: Record<string, DayTag> = {};
  const recupDates: string[] = [];
  const gridWeeks = new Set<string>();
  for (const g of grid) gridWeeks.add(isoWeekOfDate(g.date));
  for (const [week, e] of entries) {
    for (const d of e.recupDates ?? []) if (d >= gridStart && d <= gridEnd) recupDates.push(d);
    if (!gridWeeks.has(week)) continue;
    const dates = weekDates(week);
    e.days.forEach((day, i) => {
      const date = dates[i];
      if (day?.tag && date && date >= gridStart && date <= gridEnd) tags[date] = day.tag;
    });
  }

  return {
    email,
    name,
    profile: {
      weeklyHours: profile.weeklyHours,
      cpAllowanceDays: profile.cpAllowanceDays ?? null,
      recupCapHours: profile.recupCapHours ?? null,
      typicalDayMin: typicalDayMinutes(profile),
      initials: profile.initials ?? null,
    },
    counters: {
      recup: { creditMin: recup.creditMin, debitMin: recup.debitMin, balanceMin: recup.balanceMin, plannedDates: recup.plannedDates, reservedMin: recup.reservedMin, availableMin: recup.availableMin },
      cp,
      capMin,
      excessMin: recupCapExcessMin(recup.balanceMin, profile.recupCapHours),
    },
    // Congés visibles : ceux qui touchent la grille du mois + toute demande
    // encore en attente (elle doit rester actionnable où qu'elle tombe).
    conges: conges.filter((c) => c.status === "pending" || rangesOverlap(c.start, c.end, gridStart, gridEnd)),
    recupDates: [...new Set(recupDates)].sort(),
    tags,
  };
}

export async function GET(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? monthIdOf(new Date());
  if (!isMonthId(month)) return NextResponse.json({ error: "Mois invalide" }, { status: 400 });
  const todayISO = new Date().toISOString().slice(0, 10);

  try {
    if (c.isManager) {
      const [users, allEntries, profiles, allConges] = await Promise.all([
        prisma.user.findMany({ select: { name: true, email: true }, orderBy: { name: "asc" } }),
        listAllWeekEntries(),
        listProfiles(),
        listAllConges(),
      ]);
      const congesByUser = new Map<string, CongeRequest[]>();
      for (const g of allConges) {
        const list = congesByUser.get(g.email);
        if (list) list.push(g); else congesByUser.set(g.email, [g]);
      }
      const seen = new Set<string>();
      const team = (users as { name: string | null; email: string | null }[])
        .filter((u) => u.email)
        .map((u) => {
          const email = u.email!.trim().toLowerCase();
          seen.add(email);
          return buildPerson(
            email, u.name || email,
            profiles.get(email) ?? freshDefaultProfile(),
            allEntries.get(email) ?? new Map(),
            congesByUser.get(email) ?? [], month, todayISO,
          );
        });
      // Saisies orphelines (compte supprimé mais historique présent).
      for (const [email, entries] of allEntries) {
        if (seen.has(email)) continue;
        team.push(buildPerson(email, email, profiles.get(email) ?? freshDefaultProfile(), entries, congesByUser.get(email) ?? [], month, todayISO));
      }
      const me = team.find((p) => p.email === c.email)
        ?? buildPerson(c.email, c.name, await getProfile(c.email), await listUserWeekEntries(c.email), await listUserConges(c.email), month, todayISO);
      return NextResponse.json({ ok: true, month, todayISO, isManager: true, isDirection: c.isDir, me, team });
    }

    const [profile, entries, conges] = await Promise.all([
      getProfile(c.email), listUserWeekEntries(c.email), listUserConges(c.email),
    ]);
    const me = buildPerson(c.email, c.name, profile, entries, conges, month, todayISO);
    return NextResponse.json({ ok: true, month, todayISO, isManager: false, isDirection: false, me });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Profil par défaut (même défaut que getProfile, sans requête). */
function freshDefaultProfile(): HoursProfile {
  return { ...DEFAULT_PROFILE, typicalDay: { ...DEFAULT_PROFILE.typicalDay }, cpAllowanceDays: null, recupCapHours: null };
}

/** Réglages EMPLOYEUR (direction seule) : solde CP annuel + plafond récup +
 *  initiales (calendrier d'équipe mobile). */
export async function PUT(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!c.isDir) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  let body: { user?: unknown; cpAllowanceDays?: unknown; recupCapHours?: unknown; initials?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const target = String(body.user ?? "").trim().toLowerCase();
  if (!target) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });

  try {
    const cur = await getProfile(target);
    const num = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const next: HoursProfile = {
      ...cur,
      cpAllowanceDays: "cpAllowanceDays" in body ? num(body.cpAllowanceDays) : cur.cpAllowanceDays,
      recupCapHours: "recupCapHours" in body ? num(body.recupCapHours) : cur.recupCapHours,
      // Nettoyage (3 lettres max, majuscules) fait par normalizeProfile à l'écriture.
      initials: "initials" in body ? (typeof body.initials === "string" ? body.initials : null) : cur.initials,
    };
    const saved = await saveProfile(target, next);
    return NextResponse.json({ ok: true, user: target, profile: saved });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
