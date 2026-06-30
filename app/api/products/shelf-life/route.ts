import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePreparateurOrAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { setShelfLife, removeShelfLife } from "@/lib/shelfLife";

/**
 * Durée de vie par défaut (jours) par article (#1/#6 — pré-remplissage DLC).
 *
 * GET  → { items: [{ itemCode, itemName, days }] } (durées configurées)
 * POST { itemCode, days } → upsert ; days ≤ 0 → suppression. Écriture gatée
 *       préparateur / administration.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const rows = await prisma.itemShelfLife.findMany({ orderBy: { updatedAt: "desc" } });
  const codes = rows.map((r) => r.itemCode);
  const products = codes.length
    ? await prisma.product.findMany({
        where: { itemCode: { in: codes } },
        select: { itemCode: true, itemName: true },
      })
    : [];
  const nameOf = new Map(products.map((p) => [p.itemCode, p.itemName]));
  const items = rows.map((r) => ({
    itemCode: r.itemCode,
    itemName: nameOf.get(r.itemCode) ?? null,
    days: r.days,
  }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requirePreparateurOrAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la préparation / l'administration" }, { status: 403 });
  }

  let body: { itemCode?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const itemCode = (body.itemCode ?? "").trim();
  if (!itemCode) return NextResponse.json({ error: "itemCode requis" }, { status: 400 });

  const days = Number(body.days);
  if (!Number.isFinite(days)) return NextResponse.json({ error: "Nombre de jours invalide" }, { status: 400 });

  if (days <= 0) {
    await removeShelfLife(itemCode);
    return NextResponse.json({ ok: true, removed: true, itemCode });
  }
  if (days > 365) {
    return NextResponse.json({ error: "Le nombre de jours doit être compris entre 1 et 365." }, { status: 400 });
  }

  await setShelfLife(itemCode, Math.round(days), session.user?.email ?? null);
  return NextResponse.json({ ok: true, itemCode, days: Math.round(days) });
}
