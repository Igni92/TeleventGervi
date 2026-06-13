import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/notifications — notifications de l'utilisateur connecté.
 *
 * Aujourd'hui une seule source : les PROMOS ACTIVES (active = true, fenêtre
 * startsAt/endsAt ouverte). Une promo est « nouvelle » (isNew = true) tant que
 * l'utilisateur ne l'a pas consultée (aucune ligne "PromoSeen").
 *
 * Contrat (consommé par la cloche de l'Accueil et par PromoBanner) :
 *   { notifications: [{ id, kind: "promo", promoId, label, itemCode, startsAt, isNew }] }
 * Champs supplémentaires tolérés : itemName, pitch, endsAt, promoKind,
 * value, buyQty, freeQty (affichage riche dans la modale).
 *
 * ⚠️ Tables Promo / PromoSeen absentes du client Prisma généré
 *    → raw SQL paramétré exclusivement ($1, $2…).
 */

export const dynamic = "force-dynamic";

/** Identifiant utilisateur : id de session, fallback email (convention des autres routes). */
function userIdFrom(session: { user?: { id?: string | null; email?: string | null } } | null) {
  return session?.user?.id ?? session?.user?.email ?? null;
}

type Row = {
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
  itemName: string | null;
  isNew: boolean;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = userIdFrom(session);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT p."id", p."itemCode", p."kind", p."value", p."buyQty", p."freeQty",
            p."label", p."pitch", p."startsAt", p."endsAt",
            pr."itemName" AS "itemName",
            (s."promoId" IS NULL) AS "isNew"
     FROM "Promo" p
     LEFT JOIN "PromoSeen" s ON s."promoId" = p."id" AND s."userId" = $1
     LEFT JOIN "Product" pr ON pr."itemCode" = p."itemCode"
     WHERE p."active" = true
       AND (p."startsAt" IS NULL OR p."startsAt" <= NOW())
       AND (p."endsAt" IS NULL OR p."endsAt" >= NOW())
     ORDER BY (s."promoId" IS NULL) DESC, p."startsAt" DESC NULLS LAST, p."createdAt" DESC;`,
    userId,
  );

  const notifications = rows.map((r) => ({
    id: `promo:${r.id}`,
    kind: "promo" as const,
    promoId: r.id,
    label: r.label?.trim() || r.itemName || r.itemCode,
    itemCode: r.itemCode,
    startsAt: r.startsAt,
    isNew: r.isNew,
    // — extras tolérés (affichage riche) —
    itemName: r.itemName,
    pitch: r.pitch,
    endsAt: r.endsAt,
    promoKind: r.kind,
    value: r.value,
    buyQty: r.buyQty,
    freeQty: r.freeQty,
  }));

  return NextResponse.json({ notifications });
}
