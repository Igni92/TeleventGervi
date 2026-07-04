import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { NAV_OVERRIDES_KEY, sanitizeNavOverrides } from "@/lib/navOverrides";

export const dynamic = "force-dynamic";

/**
 * PERSONNALISATION de la navigation (sidebar) — réglage GLOBAL.
 *
 * GET  → { ok, overrides } (tout utilisateur connecté : la sidebar le consomme)
 * PUT  { overrides } → remplace les surcharges (ADMIN uniquement) ;
 *      { overrides: {} } = réinitialisation complète.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: NAV_OVERRIDES_KEY } });
    return NextResponse.json({ ok: true, overrides: row ? JSON.parse(row.value) : {} });
  } catch {
    return NextResponse.json({ ok: true, overrides: {} });   // réglage optionnel — jamais bloquant
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à l'administration" }, { status: 403 });
  }

  let body: { overrides?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const overrides = sanitizeNavOverrides(body.overrides);
  try {
    const value = JSON.stringify(overrides);
    await prisma.appSetting.upsert({
      where: { key: NAV_OVERRIDES_KEY },
      update: { value },
      create: { key: NAV_OVERRIDES_KEY, value },
    });
    return NextResponse.json({ ok: true, overrides });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
