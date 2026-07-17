import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products
 *
 * Query params:
 *   search        : ItemCode/ItemName contains (case-insensitive)
 *   group         : ItemsGroupCode (number)
 *   inStock       : "true" → only products with available stock > 0 in a
 *                   warehouse (a product at 0 available — even on supplier order —
 *                   is hidden here and only reachable via the "+ Rupture" mode)
 *   includePack   : "true" → include packaging-tagged items (default: false, hidden)
 *   page          : default 1
 *   limit         : default 50, max 200
 */
/** Tri serveur (clic sur en-tête de colonne côté Stock). Les colonnes de
 *  quantités agrégées (dispo / commande fournisseur) ne sont pas des colonnes
 *  SQL → on retombe sur `totalStock` (proxy raisonnable). Tri par défaut
 *  inchangé : plus gros stock d'abord. */
type OrderBy = Record<string, "asc" | "desc">;
function buildOrderBy(sort: string | null, dir: string | null): OrderBy[] {
  const d: "asc" | "desc" = dir === "asc" ? "asc" : "desc";
  const map: Record<string, string> = {
    qty: "totalStock", stock: "totalStock", ordered: "totalStock",
    code: "itemCode", fruit: "itemName", pays: "uPays",
    marque: "uMarque", variete: "frgnName", condt: "uCondi",
  };
  const col = sort ? map[sort] : null;
  if (!col) return [{ totalStock: "desc" }, { itemName: "asc" }];
  // Tie-breaker stable par nom pour les colonnes texte/quantité.
  return col === "itemName" ? [{ itemName: d }] : [{ [col]: d }, { itemName: "asc" }];
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() || "";
  const group = searchParams.get("group");
  const groupsParam = searchParams.get("groups"); // comma-separated list
  const inStockOnly = searchParams.get("inStock") === "true";
  const includePackaging = searchParams.get("includePack") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  // Plafond élevé : la prise de commande « à découvert » charge tout le catalogue
  // (articles à 0 inclus) en un appel. À 200, les articles 0-stock (ex. survendus)
  // étaient tronqués → invisibles en vente à découvert.
  const limit = Math.min(3000, Math.max(1, parseInt(searchParams.get("limit") || "50")));

  const where: Record<string, unknown> = {};
  if (!includePackaging) where.isPackaging = false;
  // "En stock" = au moins un entrepôt avec du DISPONIBLE réel (available =
  // inStock − committed > 0). Un article sans disponible — même en COMMANDE
  // FOURNISSEUR (ordered > 0) ou entièrement vendu dans la journée — n'apparaît
  // PLUS dans la vue par défaut : il est « à découvert » et ne doit être retrouvé
  // que via le mode « + Rupture » (qui retire ce filtre et charge tout le
  // catalogue, articles à 0 inclus). Demande métier : ne jamais laisser un
  // article à 0 stock proposé « à découvert » par défaut — il disparaît de la
  // liste tant qu'il n'a pas été réceptionné, et reste cherchable en rupture.
  if (inStockOnly) {
    where.stocks = { some: { available: { gt: 0 } } };
  }
  // Single group (legacy) OR multi-group (?groups=1,2,3)
  if (groupsParam) {
    const ids = groupsParam.split(",").map((s) => parseInt(s)).filter((n) => !isNaN(n));
    if (ids.length === 1) where.itemGroup = ids[0];
    else if (ids.length > 1) where.itemGroup = { in: ids };
  } else if (group) {
    where.itemGroup = parseInt(group);
  }
  if (search) {
    where.OR = [
      { itemCode: { contains: search, mode: "insensitive" } },
      { itemName: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { stocks: true },
      orderBy: buildOrderBy(searchParams.get("sort"), searchParams.get("dir")),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  // Reshape: each product gets a `stockByWarehouse` map for easier UI use.
  // Cast temporary pour les U_* fields tant que Prisma generate est bloqué.
  const products = items.map((rawP) => {
    const p = rawP as typeof rawP & {
      uPays: string | null; uMarque: string | null; uCondi: string | null;
      uCalibre: string | null;
      uUvc: string | null; uNbBarqColis: number | null; frgnName: string | null;
    };
    const stockByWarehouse: Record<string, {
      inStock: number; committed: number; ordered: number; available: number;
    }> = {};
    for (const s of p.stocks) {
      stockByWarehouse[s.warehouse] = {
        inStock: s.inStock,
        committed: s.committed,
        ordered: s.ordered,
        available: s.available,
      };
    }
    return {
      id: p.id,
      itemCode: p.itemCode,
      itemName: p.itemName,
      itemGroup: p.itemGroup,
      groupName: p.groupName,
      salesUnit: p.salesUnit,
      salesPackagingUnit: p.salesPackagingUnit,
      salesQtyPerPackUnit: p.salesQtyPerPackUnit,
      salesUnitWeight: p.salesUnitWeight,
      inventoryUnit: p.inventoryUnit,
      purchaseUnit: p.purchaseUnit,
      manageBatch: p.manageBatch,
      isPackaging: p.isPackaging,
      totalStock: p.totalStock,
      syncedAt: p.syncedAt,
      // Champs custom Gervifrais
      uPays: p.uPays,
      uMarque: p.uMarque,
      uCondi: p.uCondi,
      uCalibre: p.uCalibre,                 // = calibre (U_GER_CALIBRE)
      uUvc: p.uUvc,
      frgnName: p.frgnName,                 // = variété
      uNbBarqColis: p.uNbBarqColis,
      stockByWarehouse,
    };
  });

  return NextResponse.json({
    products,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
