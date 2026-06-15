import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/sap/clients/[id]/habits
 *
 * Petites stats "habitudes d'achat" affichées dans le bandeau en haut de la
 * fiche client (console télévente) :
 *   - lastOrderDate : DocDate de la dernière commande SAP (tous CardCodes du client)
 *   - topProducts   : top 3 articles, agrégés sur les 10 dernières commandes,
 *                     classés par nombre de commandes contenant l'article (desc),
 *                     puis par quantité cumulée (en pièces).
 *
 * Tolère SAP indisponible : retourne { lastOrderDate: null, topProducts: [] }.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const clientId = params.id;
  if (!clientId) return NextResponse.json({ error: "clientId requis" }, { status: 400 });

  // Tous les CardCodes du client (principal + modes de livraison)
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { code: true } });
  const cardCodes: string[] = [];
  if (client?.code) cardCodes.push(client.code);
  try {
    const modes = await prisma.$queryRawUnsafe<{ sapCardCode: string }[]>(
      `SELECT DISTINCT "sapCardCode" FROM "ClientDeliveryMode" WHERE "clientId" = $1`, clientId,
    );
    for (const m of modes) if (m.sapCardCode && !cardCodes.includes(m.sapCardCode)) cardCodes.push(m.sapCardCode);
  } catch { /* table optionnelle */ }

  if (cardCodes.length === 0) {
    return NextResponse.json({ lastOrderDate: null, topProducts: [] });
  }

  try {
    type Line = { ItemCode: string; ItemDescription?: string; Quantity: number };
    type Ord = { DocEntry: number; DocDate: string; DocumentLines?: Line[] };
    const filter = cardCodes.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
    const r = await sap.get<{ value: Ord[] }>(
      `Orders?$top=10&$orderby=DocEntry desc&$select=DocEntry,DocDate,DocumentLines&$filter=${encodeURIComponent(filter)}`,
    );
    const orders = r.value ?? [];

    // Date de la dernière commande
    const lastOrderDate = orders[0]?.DocDate ?? null;

    // Enrichit les noms + poids unitaire depuis la DB (plus propre que ItemDescription SAP)
    const allCodes = Array.from(new Set(
      orders.flatMap((o) => (o.DocumentLines ?? []).map((l) => l.ItemCode).filter(Boolean)),
    ));
    const prods = allCodes.length > 0 ? await prisma.product.findMany({
      where: { itemCode: { in: allCodes } },
      select: { itemCode: true, itemName: true, salesUnitWeight: true },
    }) : [];
    const nameMap = new Map(prods.map((p) => [p.itemCode, p.itemName]));
    /** Poids 1 pièce en kg, par ItemCode (0 si absent — ligne ignorée pour le poids). */
    const weightMap = new Map(prods.map((p) => [p.itemCode, p.salesUnitWeight ?? 0]));

    /**
     * Agrégation par **famille de fruit** = 1ʳᵉ "mot" du nom produit,
     * normalisé sans accents. Règle métier (cf. télévente) :
     *   - Fraise Mara / Fraise Gariguette / Fraise Pulpe … → "Fraise"
     *   - Framboise Driscolls / Framboise XX → "Framboise"
     *   - Myrtille / Mûre / Groseille restent distincts.
     * count = nb de commandes contenant ≥ 1 article de la famille
     * qty   = somme des quantités sur la fenêtre
     */
    const familyKey = (name: string) => {
      const first = name.trim().split(/\s+/)[0] ?? "";
      // strip accents + lowercase pour clé stable (U+0300..U+036F = combining marks)
      return first.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    };
    const familyLabel = (name: string) => {
      const first = name.trim().split(/\s+/)[0] ?? name;
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    };

    type Agg = { key: string; label: string; count: number; qty: number; weightKg: number };
    const agg = new Map<string, Agg>();
    for (const o of orders) {
      const seen = new Set<string>();
      for (const l of (o.DocumentLines ?? [])) {
        if (!l.ItemCode) continue;
        const name = nameMap.get(l.ItemCode) || l.ItemDescription || l.ItemCode;
        const key = familyKey(name);
        if (!key) continue;
        const cur = agg.get(key) ?? { key, label: familyLabel(name), count: 0, qty: 0, weightKg: 0 };
        const qty = l.Quantity || 0;
        cur.qty += qty;
        cur.weightKg += qty * (weightMap.get(l.ItemCode) ?? 0);
        if (!seen.has(key)) { cur.count += 1; seen.add(key); }
        agg.set(key, cur);
      }
    }

    // Top 3 familles — classement par **poids cumulé** (kg) puis nb de cdes.
    // Le commercial veut savoir « ce qu'ils achètent en volume », pas
    // « combien de fois ils l'ont commandé ».
    const top = Array.from(agg.values())
      .sort((a, b) => (b.weightKg - a.weightKg) || (b.count - a.count))
      .slice(0, 3);

    return NextResponse.json({
      lastOrderDate,
      topProducts: top.map((t) => ({
        // On garde itemCode pour compat (= clé de famille), itemName = label affiché
        itemCode: t.key,
        itemName: t.label,
        orderCount: t.count,
        weightKg: Math.round(t.weightKg * 10) / 10, // 1 décimale
      })),
    });
  } catch (e) {
    return NextResponse.json({
      lastOrderDate: null,
      topProducts: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
