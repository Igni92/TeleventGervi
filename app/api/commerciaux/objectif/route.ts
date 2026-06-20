import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/commerciaux/objectif
 *   Body: { slpName: string, objectifCa?: number, objectifMarge?: number, objectifVolume?: number }
 *
 * Définit les objectifs annuels d'un commercial (trigramme) — au choix sur le
 * CA HT, la marge brute (€) et/ou le volume (kg). Réservé aux admins. Le réalisé
 * est mesuré dans /api/commerciaux/sap. Upsert raw SQL (table hors client Prisma
 * typé — cf. prisma/migrations/manual/*commercial_objectif*).
 */
const FIELDS = ["objectifCa", "objectifMarge", "objectifVolume"] as const;
type Field = (typeof FIELDS)[number];

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const slpName = typeof body.slpName === "string" ? body.slpName.trim() : "";
  if (!slpName) return NextResponse.json({ error: "slpName requis" }, { status: 400 });

  // Chaque objectif est optionnel ; on n'upsert que ceux fournis.
  const provided: { col: Field; val: number }[] = [];
  for (const col of FIELDS) {
    if (body[col] === undefined || body[col] === null) continue;
    const n = Number(body[col]);
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `${col} invalide` }, { status: 400 });
    provided.push({ col, val: n });
  }
  if (provided.length === 0) {
    return NextResponse.json({ error: "Au moins un objectif (objectifCa/objectifMarge/objectifVolume) requis" }, { status: 400 });
  }

  const cols = provided.map((f) => `"${f.col}"`).join(", ");
  const placeholders = provided.map((_, i) => `$${i + 2}`).join(", ");
  const updates = provided.map((f) => `"${f.col}" = EXCLUDED."${f.col}"`).join(", ");

  await prisma.$executeRawUnsafe(
    `INSERT INTO "CommercialObjectif" ("slpName", ${cols}, "updatedAt")
     VALUES ($1, ${placeholders}, NOW())
     ON CONFLICT ("slpName") DO UPDATE SET ${updates}, "updatedAt" = NOW()`,
    slpName,
    ...provided.map((f) => f.val),
  );

  return NextResponse.json({ ok: true, slpName, ...Object.fromEntries(provided.map((f) => [f.col, f.val])) });
}
