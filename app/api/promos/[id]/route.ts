import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * /api/promos/[id] — modification / suppression d'une promotion.
 *
 * PATCH  body partiel (mêmes règles de validation champ par champ que le POST,
 *        dont { active: false } et { pitch }) → { ok: true } ; 404 si id inconnu.
 *        updatedAt = NOW() à chaque modification.
 * DELETE → { ok: true } ; 404 si id inconnu.
 *
 * ⚠️ Table Promo absente du client Prisma généré → raw SQL paramétré ($1, $2…).
 */

type PromoRow = {
  id: string;
  itemCode: string;
  kind: string;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  label: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
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

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  // 404 si la promo n'existe pas — on lit aussi l'existant pour valider l'état résultant.
  const existingRows = await prisma.$queryRawUnsafe<PromoRow[]>(
    `SELECT "id", "itemCode", "kind", "value", "buyQty", "freeQty",
            "label", "startsAt", "endsAt", "active"
     FROM "Promo" WHERE "id" = $1;`,
    params.id,
  );
  const existing = existingRows[0];
  if (!existing) return NextResponse.json({ error: "Promo introuvable" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return bad("Corps de requête invalide");

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  // itemCode — non vide si fourni.
  if (body.itemCode !== undefined) {
    const itemCode = typeof body.itemCode === "string" ? body.itemCode.trim() : "";
    if (!itemCode) return bad("itemCode ne peut pas être vide");
    sets.push(`"itemCode" = $${i++}`);
    values.push(itemCode);
  }

  // kind — restreint à l'énumération.
  let kind = existing.kind;
  if (body.kind !== undefined) {
    if (body.kind !== "PERCENT" && body.kind !== "X_PLUS_Y") {
      return bad("kind invalide (PERCENT ou X_PLUS_Y attendu)");
    }
    kind = body.kind;
    sets.push(`"kind" = $${i++}`);
    values.push(kind);
  }

  // value / buyQty / freeQty — null autorisé pour effacer, sinon mêmes bornes qu'au POST.
  let value = existing.value;
  if (body.value !== undefined) {
    if (body.value === null) value = null;
    else {
      const n = toNum(body.value);
      if (n === null) return bad("value doit être un nombre");
      if (n < 1 || n > 90) return bad("value doit être comprise entre 1 et 90");
      value = n;
    }
    sets.push(`"value" = $${i++}::double precision`);
    values.push(value);
  }

  let buyQty = existing.buyQty;
  if (body.buyQty !== undefined) {
    if (body.buyQty === null) buyQty = null;
    else {
      const n = toNum(body.buyQty);
      if (n === null || n < 1) return bad("buyQty doit être ≥ 1");
      buyQty = n;
    }
    sets.push(`"buyQty" = $${i++}::double precision`);
    values.push(buyQty);
  }

  let freeQty = existing.freeQty;
  if (body.freeQty !== undefined) {
    if (body.freeQty === null) freeQty = null;
    else {
      const n = toNum(body.freeQty);
      if (n === null || n < 1) return bad("freeQty doit être ≥ 1");
      freeQty = n;
    }
    sets.push(`"freeQty" = $${i++}::double precision`);
    values.push(freeQty);
  }

  // Cohérence kind ↔ champs : vérifiée seulement si l'un d'eux est touché
  // (un simple { active: false } ne doit jamais être bloqué).
  const kindFieldsTouched =
    body.kind !== undefined || body.value !== undefined ||
    body.buyQty !== undefined || body.freeQty !== undefined;
  if (kindFieldsTouched) {
    if (kind === "PERCENT") {
      if (value === null) return bad("value requise pour une promo PERCENT");
    } else {
      if (buyQty === null || buyQty < 1) return bad("buyQty doit être ≥ 1 pour une promo X_PLUS_Y");
      if (freeQty === null || freeQty < 1) return bad("freeQty doit être ≥ 1 pour une promo X_PLUS_Y");
    }
  }

  // label — null ou chaîne (vide → null).
  if (body.label !== undefined) {
    const label = body.label === null ? null : String(body.label).trim() || null;
    sets.push(`"label" = $${i++}`);
    values.push(label);
  }

  // pitch — argumentaire commercial court, null ou chaîne (vide → null).
  if (body.pitch !== undefined) {
    const pitch = body.pitch === null ? null : String(body.pitch).trim() || null;
    sets.push(`"pitch" = $${i++}`);
    values.push(pitch);
  }

  // Dates — ISO valides si fournies, null pour effacer. L'ordre startsAt < endsAt
  // est validé sur l'état résultant (fourni ?? existant).
  let startsAt = existing.startsAt ? new Date(existing.startsAt) : null;
  if (body.startsAt !== undefined) {
    if (body.startsAt === null || body.startsAt === "") startsAt = null;
    else {
      startsAt = toDate(body.startsAt);
      if (!startsAt) return bad("startsAt invalide (date ISO attendue)");
    }
    sets.push(`"startsAt" = $${i++}::timestamp`);
    values.push(startsAt);
  }

  let endsAt = existing.endsAt ? new Date(existing.endsAt) : null;
  if (body.endsAt !== undefined) {
    if (body.endsAt === null || body.endsAt === "") endsAt = null;
    else {
      endsAt = toDate(body.endsAt);
      if (!endsAt) return bad("endsAt invalide (date ISO attendue)");
    }
    sets.push(`"endsAt" = $${i++}::timestamp`);
    values.push(endsAt);
  }

  if ((body.startsAt !== undefined || body.endsAt !== undefined)
    && startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) {
    return bad("startsAt doit être antérieure à endsAt");
  }

  // active — booléen strict.
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return bad("active doit être un booléen");
    sets.push(`"active" = $${i++}`);
    values.push(body.active);
  }

  if (sets.length === 0) return NextResponse.json({ ok: true });

  sets.push(`"updatedAt" = NOW()`);
  values.push(params.id);
  await prisma.$executeRawUnsafe(
    `UPDATE "Promo" SET ${sets.join(", ")} WHERE "id" = $${i};`,
    ...values,
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const deleted = await prisma.$executeRawUnsafe(
    `DELETE FROM "Promo" WHERE "id" = $1;`,
    params.id,
  );
  if (deleted === 0) return NextResponse.json({ error: "Promo introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
