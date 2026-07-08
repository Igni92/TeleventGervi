import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope } from "@/lib/permissions";
import {
  computeWeek, isWeekId, isoWeekId, isMonthId, monthWeeks, aggregateMonth,
  type HoursProfile,
} from "@/lib/heuresCalc";
import {
  getProfile, saveProfile, listProfiles,
  getWeekEntry, saveWeekEntry,
  getUserWeeks, listEntriesForWeeks, type WeekEntry,
} from "@/lib/heuresRh";

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
        const [users, byUser, profiles] = await Promise.all([
          prisma.user.findMany({ select: { name: true, email: true }, orderBy: { name: "asc" } }),
          listEntriesForWeeks(weeks),
          listProfiles(),
        ]);
        const seen = new Set<string>();
        const rows = (users as { name: string | null; email: string | null }[])
          .filter((u) => u.email)
          .map((u) => {
            const email = u.email!.trim().toLowerCase();
            seen.add(email);
            return buildMonthRow(email, u.name || email, weeks, byUser.get(email), profiles.get(email) ?? null);
          });
        for (const [email, entries] of byUser) {
          if (!seen.has(email)) rows.push(buildMonthRow(email, email, weeks, entries, profiles.get(email) ?? null));
        }
        return NextResponse.json({ ok: true, month, weeks, rows });
      }
      const who = target && target !== c.email ? target : c.email;
      if (who !== c.email && !c.isManager) {
        return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
      }
      const [entries, profile] = await Promise.all([getUserWeeks(who, weeks), getProfile(who)]);
      const row = buildMonthRow(who, who, weeks, entries, profile);
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
    const calc = entry ? computeWeek(entry.days, profile.weeklyHours) : null;
    return NextResponse.json({ ok: true, week, user: who, entry, profile, calc });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Ligne d'état MENSUEL d'un employé : détail par semaine + agrégat du mois. */
function buildMonthRow(
  email: string,
  name: string,
  weekIds: string[],
  entries: Map<string, WeekEntry> | undefined,
  profile: HoursProfile | null,
) {
  const weeklyHours = profile?.weeklyHours ?? 35;
  const weeksOut = weekIds.map((w) => {
    const entry = entries?.get(w) ?? null;
    return {
      week: w,
      calc: entry ? computeWeek(entry.days, weeklyHours) : null,
      option: entry?.option ?? null,          // choix compta reporté sur l'état
      recupDates: entry?.recupDates,          // dates de récup (option « recup »)
    };
  });
  return {
    email,
    name,
    profile,
    weeks: weeksOut,
    total: aggregateMonth(weeksOut.map((w) => w.calc)),
  };
}

export async function POST(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { week?: string; days?: unknown; user?: string; option?: unknown; recupDates?: unknown };
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
    let opt: { option?: unknown; recupDates?: unknown } = { option: body.option, recupDates: body.recupDates };
    if (!c.isManager) {
      const existing = await getWeekEntry(target, week);
      opt = { option: existing?.option ?? null, recupDates: existing?.recupDates };
    }
    const entry = await saveWeekEntry(target, week, body.days, c.email, opt);
    const profile = await getProfile(target);
    return NextResponse.json({ ok: true, week, user: target, entry, calc: computeWeek(entry.days, profile.weeklyHours) });
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
