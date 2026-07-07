import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { NAV_OVERRIDES_KEY, toNavConfig } from "@/lib/navOverrides";

export const dynamic = "force-dynamic";

/**
 * PERSONNALISATION de la navigation (sidebar) — réglage GLOBAL.
 *
 * GET  → { ok, config: { items, categories } } (tout utilisateur connecté)
 * PUT  { config } (ou { overrides } — rétrocompat) → remplace la config
 *      (ADMIN uniquement). { config: { items:{}, categories:[] } } = reset.
 *
 * La valeur persistée est { items, categories } ; l'ancien format nu (des
 * surcharges d'items seules) reste lu grâce à toNavConfig.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: NAV_OVERRIDES_KEY } });
    return NextResponse.json({ ok: true, config: toNavConfig(row ? JSON.parse(row.value) : null) });
  } catch {
    return NextResponse.json({ ok: true, config: { items: {}, categories: [] } });   // jamais bloquant
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à l'administration" }, { status: 403 });
  }

  let body: { config?: unknown; overrides?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  // Nouveau payload { config } ; rétrocompat { overrides } (surcharges nues).
  const config = toNavConfig(body.config ?? body.overrides);
  try {
    const value = JSON.stringify(config);
    await prisma.appSetting.upsert({
      where: { key: NAV_OVERRIDES_KEY },
      update: { value },
      create: { key: NAV_OVERRIDES_KEY, value },
    });
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
