import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * /api/promos — promotions articles.
 *
 * GET  (?active=1 optionnel) → { promos: [...] } trié par createdAt DESC.
 *      active=1 → seulement active = true ET dans la fenêtre startsAt/endsAt.
 *      Chaque promo embarque `itemName` (LEFT JOIN "Product") et `pitch`
 *      (argumentaire commercial court — bandeau PromoBanner).
 * POST { itemCode, kind, value?, buyQty?, freeQty?, label?, pitch?, startsAt?, endsAt? }
 *      → { ok: true, promo } (ligne créée, RETURNING *).
 *
 * kind : 'PERCENT' (remise en %, 1 ≤ value ≤ 90)
 *        ou 'X_PLUS_Y' (buyQty achetés → freeQty offerts, chacun ≥ 1).
 *
 * ⚠️ Table Promo absente du client Prisma généré (régénération impossible —
 * EPERM dev server) → accès exclusivement en raw SQL paramétré ($1, $2…).
 */

export const dynamic = "force-dynamic";

type PromoRow = {
  id: string;
  itemCode: string;
  kind: string;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  label: string | null;
  pitch: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  itemName?: string | null;
};

/** Coercition numérique tolérante (nombre ou chaîne numérique). */
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Chaîne ISO → Date, null si invalide. */
function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const activeOnly = req.nextUrl.searchParams.get("active") === "1";
  const where = activeOnly
    ? `WHERE p."active" = true
         AND (p."startsAt" IS NULL OR p."startsAt" <= NOW())
         AND (p."endsAt" IS NULL OR p."endsAt" >= NOW())`
    : "";

  // itemName résolu côté serveur (LEFT JOIN) — évite un fetch /api/products
  // par article dans le bandeau PromoBanner.
  const promos = await prisma.$queryRawUnsafe<PromoRow[]>(
    `SELECT p."id", p."itemCode", p."kind", p."value", p."buyQty", p."freeQty",
            p."label", p."pitch", p."startsAt", p."endsAt", p."active",
            pr."itemName" AS "itemName"
     FROM "Promo" p
     LEFT JOIN "Product" pr ON pr."itemCode" = p."itemCode"
     ${where}
     ORDER BY p."createdAt" DESC;`,
  );

  return NextResponse.json({ promos });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return bad("Corps de requête invalide");

  const itemCode = typeof body.itemCode === "string" ? body.itemCode.trim() : "";
  if (!itemCode) return bad("itemCode requis");

  const kind = body.kind;
  if (kind !== "PERCENT" && kind !== "X_PLUS_Y") {
    return bad("kind invalide (PERCENT ou X_PLUS_Y attendu)");
  }

  // Champs spécifiques au type — les champs de l'autre type sont mis à NULL.
  let value: number | null = null;
  let buyQty: number | null = null;
  let freeQty: number | null = null;

  if (kind === "PERCENT") {
    value = toNum(body.value);
    if (value === null) return bad("value requise pour une promo PERCENT");
    if (value < 1 || value > 90) return bad("value doit être comprise entre 1 et 90");
  } else {
    buyQty = toNum(body.buyQty);
    freeQty = toNum(body.freeQty);
    if (buyQty === null || buyQty < 1) return bad("buyQty doit être ≥ 1 pour une promo X_PLUS_Y");
    if (freeQty === null || freeQty < 1) return bad("freeQty doit être ≥ 1 pour une promo X_PLUS_Y");
  }

  const label =
    body.label === undefined || body.label === null
      ? null
      : String(body.label).trim() || null;

  // Argumentaire commercial court (bandeau) — optionnel, vide → null.
  const pitch =
    body.pitch === undefined || body.pitch === null
      ? null
      : String(body.pitch).trim() || null;

  let startsAt: Date | null = null;
  if (body.startsAt !== undefined && body.startsAt !== null && body.startsAt !== "") {
    startsAt = toDate(body.startsAt);
    if (!startsAt) return bad("startsAt invalide (date ISO attendue)");
  }
  let endsAt: Date | null = null;
  if (body.endsAt !== undefined && body.endsAt !== null && body.endsAt !== "") {
    endsAt = toDate(body.endsAt);
    if (!endsAt) return bad("endsAt invalide (date ISO attendue)");
  }
  if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) {
    return bad("startsAt doit être antérieure à endsAt");
  }

  const rows = await prisma.$queryRawUnsafe<PromoRow[]>(
    `INSERT INTO "Promo"
       ("id", "itemCode", "kind", "value", "buyQty", "freeQty",
        "label", "pitch", "startsAt", "endsAt", "active", "createdAt", "updatedAt")
     VALUES (
       gen_random_uuid()::text, $1, $2,
       $3::double precision, $4::double precision, $5::double precision,
       $6, $7, $8::timestamp, $9::timestamp, true, NOW(), NOW()
     )
     RETURNING *;`,
    itemCode, kind, value, buyQty, freeQty, label, pitch, startsAt, endsAt,
  );

  return NextResponse.json({ ok: true, promo: rows[0] });
}
