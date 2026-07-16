import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope } from "@/lib/permissions";
import {
  computeWeek, isWeekId, isoWeekId, isMonthId, monthWeeks, aggregateMonth,
  typicalDayMinutes,
  type HoursProfile,
} from "@/lib/heuresCalc";
import {
  getProfile, saveProfile, listProfiles,
  getWeekEntry, saveWeekEntry, sanitizeDays,
  listUserWeekEntries, listAllWeekEntries, type WeekEntry,
} from "@/lib/heuresRh";
import { listUserConges, listAllConges } from "@/lib/congesRh";
import { expandOuvrables, computeMonthRecap, type CounterWeekInput } from "@/lib/planning";
import type { CongeRequest } from "@/lib/conges";

export const dynamic = "force-dynamic";

/**
 * GESTION HORAIRE HEBDOMADAIRE (onglet Effectifs).
 *
 *   GET  ?week=2026-W28            → sa propre semaine { entry, profile, calc }
 *   GET  ?week=…&user=email        → semaine d'un employé (managers)
 *   POST { week, days[7], user? }  → enregistre la semaine (soi ; manager : autrui)
 *   PUT  { profile, user? }        → enregistre le profil (contrat hebdo +
 *                                    journée type) — soi ; manager : autrui
 *
 * Managers = admin/direction (getAccessScope().all) — voient tout, corrigent
 * tout ; un employé ne lit et n'écrit QUE ses propres heures.
 */

async function ctx() {
  const session = await auth();
  if (!session?.user) return null;
  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) return null;
  const scope = await getAccessScope(session);
  return { email, name: session.user.name?.trim() || email, isManager: !!scope.all };
}

export async function GET(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const all = searchParams.get("all") === "1";
  const target = (searchParams.get("user") ?? "").trim().toLowerCase();

  // ── ÉTAT MENSUEL : ?month=YYYY-MM — regroupe les semaines ISO dont le
  //    dimanche tombe dans le mois (les majorations restent hebdomadaires,
  //    on n'agrège que les résultats). ──
  const month = searchParams.get("month");
  if (month != null) {
    if (!isMonthId(month)) return NextResponse.json({ error: "Mois invalide" }, { status: 400 });
    const weeks = monthWeeks(month);
    try {
      if (all) {
        if (!c.isManager) return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
        // Toutes les semaines (pas seulement le mois) : le RÉCAP (solde récup,
        // plafond → « à payer M+1 ») porte sur l'HISTORIQUE complet.
        const [users, byUser, profiles, allConges] = await Promise.all([
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
        const rows = (users as { name: string | null; email: string | null }[])
          .filter((u) => u.email)
          .map((u) => {
            const email = u.email!.trim().toLowerCase();
            seen.add(email);
            return buildMonthRow(email, u.name || email, weeks, byUser.get(email), profiles.get(email) ?? null, congesByUser.get(email) ?? [], month);
          });
        for (const [email, entries] of byUser) {
          if (!seen.has(email)) rows.push(buildMonthRow(email, email, weeks, entries, profiles.get(email) ?? null, congesByUser.get(email) ?? [], month));
        }
        return NextResponse.json({ ok: true, month, weeks, rows });
      }
      const who = target && target !== c.email ? target : c.email;
      if (who !== c.email && !c.isManager) {
        return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
      }
      const [entries, profile, conges] = await Promise.all([
        listUserWeekEntries(who), getProfile(who), listUserConges(who),
      ]);
      const row = buildMonthRow(who, who, weeks, entries, profile, conges, month);
      return NextResponse.json({ ok: true, month, user: who, ...row });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  const week = searchParams.get("week") ?? isoWeekId(new Date());
  if (!isWeekId(week)) return NextResponse.json({ error: "Semaine invalide" }, { status: 400 });

  try {
    const who = target && target !== c.email ? target : c.email;
    if (who !== c.email && !c.isManager) {
      return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
    }
    const [entry, profile] = await Promise.all([getWeekEntry(who, week), getProfile(who)]);
    const calc = entry ? computeWeek(entry.days, profile.weeklyHours, typicalDayMinutes(profile)) : null;
    return NextResponse.json({ ok: true, week, user: who, entry, profile, calc });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Ligne d'état MENSUEL d'un employé : détail par semaine + agrégat du mois +
 *  RÉCAP compteurs (solde récup fin de mois, plafond employeur, excédent « à
 *  payer sur le bulletin M+1 », solde CP) — reporté sur le PDF compta. */
function buildMonthRow(
  email: string,
  name: string,
  weekIds: string[],
  entries: Map<string, WeekEntry> | undefined,
  profile: HoursProfile | null,
  conges: CongeRequest[],
  monthId: string,
) {
  const prof: HoursProfile = profile ?? { weeklyHours: 35, typicalDay: { m1: "06:00", m2: "13:00" } };
  const typDay = typicalDayMinutes(prof);
  const weeksOut = weekIds.map((w) => {
    const entry = entries?.get(w) ?? null;
    return {
      week: w,
      calc: entry ? computeWeek(entry.days, prof.weeklyHours, typDay) : null,
      option: entry?.option ?? null,          // choix compta reporté sur l'état
      paySuppMin: entry?.paySuppMin,          // part payée (option « mixte »)
      recupDates: entry?.recupDates,          // dates de récup (options « recup »/« mixte »)
    };
  });
  const allWeeks: CounterWeekInput[] = [...(entries ?? new Map<string, WeekEntry>()).entries()]
    .map(([week, e]) => ({ week, days: e.days, option: e.option, paySuppMin: e.paySuppMin, recupDates: e.recupDates }));
  const extraRecup = conges
    .filter((g) => g.type === "recup" && g.status === "approved")
    .flatMap((g) => expandOuvrables(g.start, g.end));
  return {
    email,
    name,
    profile,
    weeks: weeksOut,
    total: aggregateMonth(weeksOut.map((w) => w.calc)),
    recap: computeMonthRecap(allWeeks, extraRecup, conges, prof, monthId),
  };
}

export async function POST(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { week?: string; days?: unknown; user?: string; option?: unknown; paySuppMin?: unknown; recupDates?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const week = body.week ?? "";
  if (!isWeekId(week)) return NextResponse.json({ error: "Semaine invalide" }, { status: 400 });
  const target = (body.user ?? "").trim().toLowerCase() || c.email;
  if (target !== c.email && !c.isManager) {
    return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
  }

  try {
    // Le choix récup / paiement est une décision de l'EMPLOYEUR : un non-manager
    // ne peut pas le poser ni le modifier. On conserve alors la décision déjà
    // enregistrée, quelle que soit la charge utile envoyée.
    let opt: { option?: unknown; paySuppMin?: unknown; recupDates?: unknown } =
      { option: body.option, paySuppMin: body.paySuppMin, recupDates: body.recupDates };
    if (!c.isManager) {
      const existing = await getWeekEntry(target, week);
      opt = { option: existing?.option ?? null, paySuppMin: existing?.paySuppMin, recupDates: existing?.recupDates };
    }

    // RECALCUL anti-« récup fantôme » : la récup ne concerne QUE des heures supp.
    // Si, au final, la semaine n'a PAS d'heures supp (total ≤ contrat, les 35 h
    // sont faites sans dépassement), il n'y a plus rien à récupérer/payer → on
    // ANNULE l'option, quoi qu'il ait été enregistré avant (évite d'accorder une
    // récup pour des heures en réalité travaillées).
    const profile = await getProfile(target);
    const typDay = typicalDayMinutes(profile);
    const calc = computeWeek(sanitizeDays(body.days), profile.weeklyHours, typDay);
    if (calc.sup25Min + calc.sup50Min === 0) opt = { option: null, paySuppMin: undefined, recupDates: undefined };

    const entry = await saveWeekEntry(target, week, body.days, c.email, opt);
    return NextResponse.json({ ok: true, week, user: target, entry, calc: computeWeek(entry.days, profile.weeklyHours, typDay) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** PATCH { week, user, option, paySuppMin?, recupDates? } — pose UNIQUEMENT la
 *  décision compta d'une semaine (paiement / récup / mixte) SANS toucher aux
 *  jours saisis. Réservé aux managers : c'est le détail « avant PDF compta »
 *  (payer un bout des heures supp, laisser le reste en récup, par employé). */
export async function PATCH(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!c.isManager) return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });

  let body: { week?: string; user?: string; option?: unknown; paySuppMin?: unknown; recupDates?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const week = body.week ?? "";
  if (!isWeekId(week)) return NextResponse.json({ error: "Semaine invalide" }, { status: 400 });
  const target = (body.user ?? "").trim().toLowerCase() || c.email;

  try {
    const existing = await getWeekEntry(target, week);
    if (!existing) return NextResponse.json({ error: "Semaine non saisie" }, { status: 404 });

    const profile = await getProfile(target);
    const typDay = typicalDayMinutes(profile);
    const calc = computeWeek(existing.days, profile.weeklyHours, typDay);
    // Pas d'heures supp → aucune décision à poser (anti-« récup fantôme »).
    const opt = calc.sup25Min + calc.sup50Min === 0
      ? { option: null, paySuppMin: undefined, recupDates: undefined }
      : {
          option: body.option,
          paySuppMin: body.paySuppMin,
          // recupDates omis dans le payload → celles déjà posées sont conservées.
          recupDates: body.recupDates === undefined ? existing.recupDates : body.recupDates,
        };
    const entry = await saveWeekEntry(target, week, existing.days, c.email, opt);
    return NextResponse.json({ ok: true, week, user: target, entry, calc });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { profile?: unknown; user?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const target = (body.user ?? "").trim().toLowerCase() || c.email;
  if (target !== c.email && !c.isManager) {
    return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
  }

  try {
    const profile = await saveProfile(target, body.profile);
    return NextResponse.json({ ok: true, user: target, profile });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
