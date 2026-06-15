import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/commerciaux/objectif
 *   Body: { slpName: string, objectifCa: number }
 *
 * Définit l'objectif de CA annuel d'un commercial (trigramme). Réservé aux
 * admins. Le réalisé est mesuré sur le portefeuille (clients affectés) dans
 * /api/commerciaux/sap. Upsert raw SQL (table hors client Prisma typé —
 * cf. scripts/ddl-commercial-objectif.mjs).
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  let body: { slpName?: string; objectifCa?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const slpName = body.slpName?.trim();
  if (!slpName) return NextResponse.json({ error: "slpName requis" }, { status: 400 });
  const objectifCa = Number(body.objectifCa);
  if (!Number.isFinite(objectifCa) || objectifCa < 0) {
    return NextResponse.json({ error: "objectifCa invalide" }, { status: 400 });
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "CommercialObjectif" ("slpName", "objectifCa", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("slpName") DO UPDATE SET "objectifCa" = EXCLUDED."objectifCa", "updatedAt" = NOW()`,
    slpName,
    objectifCa,
  );

  return NextResponse.json({ ok: true, slpName, objectifCa });
}
