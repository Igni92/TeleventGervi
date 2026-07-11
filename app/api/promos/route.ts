import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * /api/promos — promotions articles.
 *
 * GET  (?active=1 & ?storeType=GMS optionnels) → { promos: [...] } trié par createdAt DESC.
 *      active=1 → seulement active = true ET dans la fenêtre startsAt/endsAt.
 *      storeType=GMS → seulement les promos ciblant ce type de magasin OU non
 *        ciblées (storeType NULL = tous les magasins).
 *      Chaque promo embarque `itemName` + les tags produit (marque / pays /
 *      conditionnement / variété via LEFT JOIN "Product") et `pitch`
 *      (argumentaire commercial court — bandeau PromoBanner).
 * POST { itemCode, kind, value?, buyQty?, freeQty?, label?, pitch?, storeType?, startsAt?, endsAt? }
 *      → { ok: true, promo } (ligne créée, RETURNING *).
 *
 * kind : 'PERCENT'  (remise en %, 1 ≤ value ≤ 90)
 *        'X_PLUS_Y' (buyQty achetés → freeQty offerts, chacun ≥ 1)
 *        'FREE'     (freeQty colis offerts, sans seuil d'achat — « 1 colis offert »)
 *        'PRICE'    (value = PRIX UNITAIRE fixe imposé, > 0 — « change le tarif »).
 *
 * storeType : EXPORT | GMS | CHR ciblé (la promo ne s'applique qu'aux magasins de
 *        ce type) — absent/null = tous les magasins.
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
  storeType: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  itemName?: string | null;
  // Tags produit résolus (LEFT JOIN "Product") — pour le libellé riche à tags.
  marque?: string | null;
  pays?: string | null;
  condi?: string | null;
  variete?: string | null;
};

/** Types de magasin ciblables (Client.type). */
const STORE_TYPES = ["EXPORT", "GMS", "CHR"] as const;

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
  const storeTypeParam = (req.nextUrl.searchParams.get("storeType") || "").trim().toUpperCase();

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (activeOnly) {
    clauses.push(`p."active" = true
         AND (p."startsAt" IS NULL OR p."startsAt" <= NOW())
         AND (p."endsAt" IS NULL OR p."endsAt" >= NOW())`);
  }
  // Filtre type de magasin : une promo ciblée (storeType renseigné) ne remonte
  // que pour son type ; les promos non ciblées (NULL) valent pour tous.
  if (STORE_TYPES.includes(storeTypeParam as (typeof STORE_TYPES)[number])) {
    params.push(storeTypeParam);
    clauses.push(`(p."storeType" IS NULL OR p."storeType" = $${params.length})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  // itemName + tags produit résolus côté serveur (LEFT JOIN) — évite un fetch
  // /api/products par article dans le bandeau et permet le libellé riche à tags.
  const promos = await prisma.$queryRawUnsafe<PromoRow[]>(
    `SELECT p."id", p."itemCode", p."kind", p."value", p."buyQty", p."freeQty",
            p."label", p."pitch", p."storeType", p."startsAt", p."endsAt", p."active",
            pr."itemName" AS "itemName",
            pr."uMarque" AS "marque", pr."uPays" AS "pays",
            COALESCE(pr."uCondi", pr."uUvc") AS "condi", pr."frgnName" AS "variete"
     FROM "Promo" p
     LEFT JOIN "Product" pr ON pr."itemCode" = p."itemCode"
     ${where}
     ORDER BY p."createdAt" DESC;`,
    ...params,
  );

  return NextResponse.json({ promos });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return bad("Corps de requête invalide");

  const itemCode = typeof body.itemCode === "string" ? body.itemCode.trim() : "";
  if (!itemCode) return bad("itemCode requis");

  const kind = body.kind;
  if (kind !== "PERCENT" && kind !== "X_PLUS_Y" && kind !== "FREE" && kind !== "PRICE") {
    return bad("kind invalide (PERCENT, X_PLUS_Y, FREE ou PRICE attendu)");
  }

  // Champs spécifiques au type — les champs des autres types sont mis à NULL.
  let value: number | null = null;
  let buyQty: number | null = null;
  let freeQty: number | null = null;

  if (kind === "PERCENT") {
    value = toNum(body.value);
    if (value === null) return bad("value requise pour une promo PERCENT");
    if (value < 1 || value > 90) return bad("value doit être comprise entre 1 et 90");
  } else if (kind === "PRICE") {
    // PRICE — value = PRIX UNITAIRE fixe imposé (€), > 0, plafond de garde 100000.
    value = toNum(body.value);
    if (value === null) return bad("value (prix) requise pour une promo PRICE");
    if (value <= 0 || value > 100000) return bad("value doit être un prix > 0");
  } else if (kind === "X_PLUS_Y") {
    buyQty = toNum(body.buyQty);
    freeQty = toNum(body.freeQty);
    if (buyQty === null || buyQty < 1) return bad("buyQty doit être ≥ 1 pour une promo X_PLUS_Y");
    if (freeQty === null || freeQty < 1) return bad("freeQty doit être ≥ 1 pour une promo X_PLUS_Y");
  } else {
    // FREE — « N colis offerts », sans seuil d'achat (buyQty/value restent NULL).
    freeQty = toNum(body.freeQty);
    if (freeQty === null || freeQty < 1) return bad("freeQty doit être ≥ 1 pour une promo FREE");
  }

  // storeType — cible facultative (EXPORT | GMS | CHR). Vide/absent = tous.
  let storeType: string | null = null;
  if (body.storeType !== undefined && body.storeType !== null && body.storeType !== "") {
    const st = String(body.storeType).trim().toUpperCase();
    if (!STORE_TYPES.includes(st as (typeof STORE_TYPES)[number])) {
      return bad("storeType invalide (EXPORT, GMS ou CHR attendu)");
    }
    storeType = st;
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
        "label", "pitch", "storeType", "startsAt", "endsAt", "active", "createdAt", "updatedAt")
     VALUES (
       gen_random_uuid()::text, $1, $2,
       $3::double precision, $4::double precision, $5::double precision,
       $6, $7, $8, $9::timestamp, $10::timestamp, true, NOW(), NOW()
     )
     RETURNING *;`,
    itemCode, kind, value, buyQty, freeQty, label, pitch, storeType, startsAt, endsAt,
  );

  return NextResponse.json({ ok: true, promo: rows[0] });
}
