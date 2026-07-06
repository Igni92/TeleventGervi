import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope } from "@/lib/permissions";
import { computeWeek, isWeekId, isoWeekId, type HoursProfile } from "@/lib/heuresCalc";
import {
  getProfile, saveProfile, listProfiles,
  getWeekEntry, saveWeekEntry, listWeekEntries,
} from "@/lib/heuresRh";

export const dynamic = "force-dynamic";

/**
 * GESTION HORAIRE HEBDOMADAIRE (onglet Effectifs).
 *
 *   GET  ?week=2026-W28            → sa propre semaine { entry, profile, calc }
 *   GET  ?week=…&user=email        → semaine d'un employé (managers)
 *   GET  ?week=…&all=1             → toute l'équipe (managers) : [{ email, name,
 *                                    entry?, profile, calc? }] — employés sans
 *                                    saisie inclus (entry absente)
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
  const week = searchParams.get("week") ?? isoWeekId(new Date());
  if (!isWeekId(week)) return NextResponse.json({ error: "Semaine invalide" }, { status: 400 });
  const all = searchParams.get("all") === "1";
  const target = (searchParams.get("user") ?? "").trim().toLowerCase();

  try {
    if (all) {
      if (!c.isManager) return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
      const [users, entries, profiles] = await Promise.all([
        prisma.user.findMany({ select: { name: true, email: true }, orderBy: { name: "asc" } }),
        listWeekEntries(week),
        listProfiles(),
      ]);
      const seen = new Set<string>();
      const rows = (users as { name: string | null; email: string | null }[])
        .filter((u) => u.email)
        .map((u) => {
          const email = u.email!.trim().toLowerCase();
          seen.add(email);
          const entry = entries.get(email) ?? null;
          const profile = profiles.get(email) ?? null;
          return buildRow(email, u.name || email, entry, profile);
        });
      // Saisies orphelines (compte supprimé / email hors table User) — visibles quand même.
      for (const [email, entry] of entries) {
        if (!seen.has(email)) rows.push(buildRow(email, email, entry, profiles.get(email) ?? null));
      }
      return NextResponse.json({ ok: true, week, rows });
    }

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

function buildRow(
  email: string,
  name: string,
  entry: { days: import("@/lib/heuresCalc").DayHours[]; updatedAt: string; updatedBy: string } | null,
  profile: HoursProfile | null,
) {
  const prof = profile ?? undefined;
  return {
    email,
    name,
    entry,
    profile: prof ?? null,
    calc: entry ? computeWeek(entry.days, (prof?.weeklyHours ?? 35)) : null,
  };
}

export async function POST(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { week?: string; days?: unknown; user?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const week = body.week ?? "";
  if (!isWeekId(week)) return NextResponse.json({ error: "Semaine invalide" }, { status: 400 });
  const target = (body.user ?? "").trim().toLowerCase() || c.email;
  if (target !== c.email && !c.isManager) {
    return NextResponse.json({ error: "Réservé aux managers" }, { status: 403 });
  }

  try {
    const entry = await saveWeekEntry(target, week, body.days, c.email);
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
