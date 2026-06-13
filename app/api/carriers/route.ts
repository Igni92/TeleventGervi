import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET  /api/carriers       — liste (active=true par défaut, ?all=1 pour tout)
 * POST /api/carriers       — crée un transporteur (admin)
 *
 * Champ SAP cible = ORDR.U_TrspCode (confirmé utilisateur). `sapField` reste
 * stocké au cas où un champ alternatif émerge, mais le push Order utilise
 * `sapValue` comme valeur U_TrspCode.
 *
 * Implémenté en raw SQL pour ne pas dépendre d'un `prisma generate` post-push.
 */

type CarrierRow = {
  id: string;
  name: string;
  kind: string;
  sapField: string | null;
  sapValue: string | null;
  active: boolean;
  position: number;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const showAll = req.nextUrl.searchParams.get("all") === "1";
  const rows = await prisma.$queryRaw<CarrierRow[]>(Prisma.sql`
    SELECT "id", "name", "kind", "sapField", "sapValue", "active", "position"
    FROM "Carrier"
    ${showAll ? Prisma.empty : Prisma.sql`WHERE "active" = true`}
    ORDER BY "position" ASC, "name" ASC;
  `);
  return NextResponse.json({ ok: true, carriers: rows });
}

const PostSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(80),
  kind: z.enum(["cardcode", "field"]),
  sapField: z.string().trim().max(60).optional().nullable(),
  sapValue: z.string().trim().max(60).optional().nullable(),
  position: z.number().int().min(0).max(9999).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  // Par défaut sapField = U_TrspCode pour kind=field (cas TeleVent / Gervifrais).
  const sapField =
    parsed.data.kind === "field"
      ? (parsed.data.sapField?.trim() || "U_TrspCode")
      : null;
  const sapValue = parsed.data.sapValue?.trim() || null;
  const position = parsed.data.position ?? 0;

  try {
    const id = `c_${Math.random().toString(36).slice(2, 12)}`;
    await prisma.$executeRaw`
      INSERT INTO "Carrier" ("id", "name", "kind", "sapField", "sapValue", "active", "position", "createdAt", "updatedAt")
      VALUES (${id}, ${parsed.data.name}, ${parsed.data.kind}, ${sapField}, ${sapValue}, true, ${position}, NOW(), NOW());
    `;
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate") || msg.includes("Carrier_name_key")) {
      return NextResponse.json({ ok: false, error: "Un transporteur avec ce nom existe déjà" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
