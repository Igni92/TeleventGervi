import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * Environnement SAP actif (prod ↔ test) — basculable à chaud.
 *
 * GET  /api/sap/environment  → { env, company, testCompany, prodCompany, testConfigured }
 * POST /api/sap/environment  body { env: "prod" | "test" }
 *   → persiste dans AppSetting('sap_env') + applique au client SAP (re-login
 *     sur la nouvelle société). ⚠️ Toutes les écritures suivantes (commandes,
 *     BL, réceptions, production) iront sur la base choisie.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  return NextResponse.json({ ok: true, ...sap.getEnvironment() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const env = body?.env;
  if (env !== "prod" && env !== "test") {
    return NextResponse.json({ error: "env doit valoir 'prod' ou 'test'" }, { status: 400 });
  }

  try {
    // Applique d'abord (peut throw si test non configuré), puis persiste.
    sap.setEnvironment(env);
    await prisma.$executeRaw`
      INSERT INTO "AppSetting" ("key", "value", "updatedAt")
      VALUES ('sap_env', ${env}, NOW())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW();
    `;
    const who = session.user.name ?? session.user.email ?? "?";
    console.log(`[SAP env] Bascule → ${env} (${sap.getEnvironment().company}) par ${who}`);
    return NextResponse.json({ ok: true, ...sap.getEnvironment() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
