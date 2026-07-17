import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import type { SapItem } from "@/lib/sapb1";
import { PURCHASE_PRICE_LIST } from "@/lib/gerviPricing";
import { requirePreparateurOrAdmin } from "@/lib/permissions";

/**
 * FICHE ARTICLE — lecture/édition des infos SAP d'un article (SAP Items / OITM).
 *
 * GET   /api/products/[id]  → fiche complète (données éditables lues EN DIRECT de
 *                             SAP quand dispo, repli sur le cache local ; + stock
 *                             par entrepôt, dernier prix d'achat, commentaire).
 * PATCH /api/products/[id]  → écrit les modifications dans SAP (Items) ET rafraîchit
 *                             le cache local. Réservé préparateur / administration.
 *
 * Conditionnement : ACHAT = PurchaseUnit, VENTE = SalesUnit, STOCKAGE = InventoryUOM.
 * Le prix d'achat (liste SAP n°2) reste EN LECTURE (il vient des réceptions).
 * `commentaire` est une note INTERNE (n'existe pas dans SAP) stockée localement.
 *
 * Les colonnes locales `barCode` / `commentaire` sont lues/écrites en SQL brut
 * (DDL défensive IF NOT EXISTS) pour ne pas dépendre de la régénération Prisma.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Colonnes locales additionnelles créées de façon défensive (idempotent). */
async function ensureColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barCode" TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "commentaire" TEXT;`);
}

interface LocalProductRow {
  itemCode: string;
  itemName: string;
  itemGroup: number | null;
  groupName: string | null;
  salesUnit: string | null;
  salesPackagingUnit: string | null;
  salesQtyPerPackUnit: number | null;
  salesUnitWeight: number | null;
  inventoryUnit: string | null;
  purchaseUnit: string | null;
  manageBatch: boolean;
  totalStock: number;
  uPays: string | null;
  uMarque: string | null;
  uCondi: string | null;
  uCalibre: string | null;
  uUvc: string | null;
  uNbBarqColis: number | null;
  frgnName: string | null;
  barCode: string | null;
  commentaire: string | null;
}

const SELECT_ITEM =
  "ItemCode,ItemName,ForeignName,ItemsGroupCode,BarCode,SalesUnit,SalesPackagingUnit," +
  "SalesQtyPerPackUnit,SalesItemsPerUnit,SalesUnitWeight,InventoryUOM,PurchaseUnit," +
  "ManageBatchNumbers,QuantityOnStock,Valid,Frozen,ItemPrices,U_Pays,U_GER_Marque," +
  "U_GER_Det_Condt,U_GER_CALIBRE,U_GER_UVC,U_GER_NB_BARQ_COLIS";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  await ensureColumns();

  // Cache local (robuste à la dérive du client Prisma → SELECT brut explicite).
  const rows = await prisma.$queryRaw<LocalProductRow[]>`
    SELECT "itemCode","itemName","itemGroup","groupName","salesUnit","salesPackagingUnit",
           "salesQtyPerPackUnit","salesUnitWeight","inventoryUnit","purchaseUnit","manageBatch",
           "totalStock","uPays","uMarque","uCondi","uCalibre","uUvc","uNbBarqColis","frgnName",
           "barCode","commentaire"
    FROM "Product" WHERE "id" = ${params.id} LIMIT 1`;
  const local = rows[0];
  if (!local) return NextResponse.json({ error: "Article introuvable" }, { status: 404 });

  // Stock par entrepôt (modèle stable).
  const stocks = await prisma.productStock.findMany({ where: { product: { id: params.id } } });
  const stockByWarehouse: Record<string, { inStock: number; committed: number; ordered: number; available: number }> = {};
  for (const s of stocks) {
    stockByWarehouse[s.warehouse] = { inStock: s.inStock, committed: s.committed, ordered: s.ordered, available: s.available };
  }

  // Lecture LIVE SAP (données éditables les plus fraîches). Best-effort : si SAP
  // est indisponible, on sert le cache local (la fiche s'ouvre quand même).
  let sapLive = false;
  let sapItem: SapItem | null = null;
  try {
    sapItem = await sap.get<SapItem>(`Items('${local.itemCode.replace(/'/g, "''")}')?$select=${SELECT_ITEM}`);
    sapLive = true;
  } catch {
    sapLive = false;
  }

  const pick = <T,>(live: T | undefined | null, cached: T | null): T | null =>
    (live !== undefined && live !== null ? live : cached);

  const prixAchat = sapItem?.ItemPrices?.find((p) => p.PriceList === PURCHASE_PRICE_LIST)?.Price ?? null;
  const prixAchatCurrency = sapItem?.ItemPrices?.find((p) => p.PriceList === PURCHASE_PRICE_LIST)?.Currency ?? null;

  return NextResponse.json({
    id: params.id,
    itemCode: local.itemCode,
    sapLive,
    // Lecture seule
    itemGroup: local.itemGroup,
    groupName: local.groupName,
    totalStock: sapItem?.QuantityOnStock ?? local.totalStock,
    stockByWarehouse,
    manageBatch: sapItem ? sapItem.ManageBatchNumbers === "tYES" : local.manageBatch,
    valid: sapItem ? sapItem.Valid !== "tNO" : true,
    frozen: sapItem ? sapItem.Frozen === "tYES" : false,
    prixAchat,
    prixAchatCurrency,
    // Champs ÉDITABLES (live SAP en priorité, repli cache)
    fields: {
      itemName: pick(sapItem?.ItemName, local.itemName) ?? "",
      variete: pick(sapItem?.ForeignName, local.frgnName) ?? "",
      barCode: pick(sapItem?.BarCode, local.barCode) ?? "",
      // Conditionnement
      purchaseUnit: pick(sapItem?.PurchaseUnit, local.purchaseUnit) ?? "",   // ACHAT
      salesUnit: pick(sapItem?.SalesUnit, local.salesUnit) ?? "",            // VENTE
      inventoryUnit: pick(sapItem?.InventoryUOM, local.inventoryUnit) ?? "", // STOCKAGE
      salesPackagingUnit: pick(sapItem?.SalesPackagingUnit, local.salesPackagingUnit) ?? "",
      salesQtyPerPackUnit: pick(sapItem?.SalesQtyPerPackUnit, local.salesQtyPerPackUnit),
      salesUnitWeight: pick(sapItem?.SalesUnitWeight, local.salesUnitWeight),
      // Attributs Gervifrais
      uPays: pick(sapItem?.U_Pays, local.uPays) ?? "",
      uMarque: pick(sapItem?.U_GER_Marque, local.uMarque) ?? "",
      uCondi: pick(sapItem?.U_GER_Det_Condt, local.uCondi) ?? "",
      uCalibre: pick(sapItem?.U_GER_CALIBRE, local.uCalibre) ?? "",
      uUvc: pick(sapItem?.U_GER_UVC, local.uUvc) ?? "",
      uNbBarqColis: pick(sapItem?.U_GER_NB_BARQ_COLIS, local.uNbBarqColis),
      // Note interne (local only)
      commentaire: local.commentaire ?? "",
    },
  });
}

/** Corps d'édition — tous les champs sont optionnels ; on n'envoie à SAP que ce
 *  qui a une valeur définie. `commentaire` reste local. */
interface PatchBody {
  itemName?: string;
  variete?: string;
  barCode?: string;
  purchaseUnit?: string;
  salesUnit?: string;
  inventoryUnit?: string;
  salesPackagingUnit?: string;
  salesQtyPerPackUnit?: number | null;
  salesUnitWeight?: number | null;
  uPays?: string;
  uMarque?: string;
  uCondi?: string;
  uCalibre?: string;
  uUvc?: string;
  uNbBarqColis?: number | null;
  commentaire?: string;
}

const s = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(x) ? x : null;
};

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Écrire dans SAP = geste de gestion → préparateur / administration.
  if (!(await requirePreparateurOrAdmin(session)))
    return NextResponse.json({ error: "Action réservée à la gestion (préparateur / administration)." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;

  await ensureColumns();
  const row = await prisma.$queryRaw<{ itemCode: string }[]>`
    SELECT "itemCode" FROM "Product" WHERE "id" = ${params.id} LIMIT 1`;
  const itemCode = row[0]?.itemCode;
  if (!itemCode) return NextResponse.json({ error: "Article introuvable" }, { status: 404 });

  // Normalisation.
  const f = {
    itemName: s(body.itemName),
    variete: s(body.variete),
    barCode: s(body.barCode),
    purchaseUnit: s(body.purchaseUnit),
    salesUnit: s(body.salesUnit),
    inventoryUnit: s(body.inventoryUnit),
    salesPackagingUnit: s(body.salesPackagingUnit),
    salesQtyPerPackUnit: n(body.salesQtyPerPackUnit),
    salesUnitWeight: n(body.salesUnitWeight),
    uPays: s(body.uPays),
    uMarque: s(body.uMarque),
    uCondi: s(body.uCondi),
    uCalibre: s(body.uCalibre),
    uUvc: s(body.uUvc),
    uNbBarqColis: n(body.uNbBarqColis),
    commentaire: s(body.commentaire),
  };
  if (!f.itemName) return NextResponse.json({ error: "Le nom de l'article est obligatoire." }, { status: 400 });

  // 1) Écriture SAP Items (champs présents dans le corps uniquement).
  const sapPayload: Record<string, unknown> = {};
  const has = (k: keyof PatchBody) => Object.prototype.hasOwnProperty.call(body, k);
  if (has("itemName")) sapPayload.ItemName = f.itemName;
  if (has("variete")) sapPayload.ForeignName = f.variete ?? "";
  if (has("barCode")) sapPayload.BarCode = f.barCode ?? "";
  if (has("purchaseUnit")) sapPayload.PurchaseUnit = f.purchaseUnit ?? "";
  if (has("salesUnit")) sapPayload.SalesUnit = f.salesUnit ?? "";
  if (has("inventoryUnit")) sapPayload.InventoryUOM = f.inventoryUnit ?? "";
  if (has("salesPackagingUnit")) sapPayload.SalesPackagingUnit = f.salesPackagingUnit ?? "";
  if (has("salesQtyPerPackUnit")) sapPayload.SalesQtyPerPackUnit = f.salesQtyPerPackUnit;
  if (has("salesUnitWeight")) sapPayload.SalesUnitWeight = f.salesUnitWeight;
  if (has("uPays")) sapPayload.U_Pays = f.uPays ?? "";
  if (has("uMarque")) sapPayload.U_GER_Marque = f.uMarque ?? "";
  if (has("uCondi")) sapPayload.U_GER_Det_Condt = f.uCondi ?? "";
  if (has("uCalibre")) sapPayload.U_GER_CALIBRE = f.uCalibre ?? "";
  if (has("uUvc")) sapPayload.U_GER_UVC = f.uUvc ?? "";
  if (has("uNbBarqColis")) sapPayload.U_GER_NB_BARQ_COLIS = f.uNbBarqColis;

  let sapOk = true;
  let sapError: string | null = null;
  if (Object.keys(sapPayload).length > 0) {
    try {
      await sap.patch(`Items('${itemCode.replace(/'/g, "''")}')`, sapPayload);
    } catch (e) {
      sapOk = false;
      sapError = e instanceof Error ? e.message : String(e);
      console.error(`[PATCH /api/products/${params.id}] SAP Items write failed:`, sapError);
    }
  }

  // 2) Rafraîchit le cache local (SQL brut → indépendant du client Prisma). La
  //    note interne `commentaire` et le `barCode` sont toujours sauvegardés
  //    localement, même si SAP a échoué (le commentaire n'existe que localement).
  await prisma.$executeRaw`
    UPDATE "Product" SET
      "itemName" = ${f.itemName},
      "frgnName" = ${f.variete},
      "barCode" = ${f.barCode},
      "purchaseUnit" = ${f.purchaseUnit},
      "salesUnit" = ${f.salesUnit},
      "inventoryUnit" = ${f.inventoryUnit},
      "salesPackagingUnit" = ${f.salesPackagingUnit},
      "salesQtyPerPackUnit" = ${f.salesQtyPerPackUnit},
      "salesUnitWeight" = ${f.salesUnitWeight},
      "uPays" = ${f.uPays},
      "uMarque" = ${f.uMarque},
      "uCondi" = ${f.uCondi},
      "uCalibre" = ${f.uCalibre},
      "uUvc" = ${f.uUvc},
      "uNbBarqColis" = ${f.uNbBarqColis},
      "commentaire" = ${f.commentaire}
    WHERE "id" = ${params.id}`;

  return NextResponse.json({
    ok: sapOk,
    sapOk,
    sapError,
    company: sap.getEnvironment().company,
    message: sapOk
      ? "Article enregistré (SAP + cache local)."
      : "Commentaire et cache local enregistrés, mais l'écriture SAP a échoué.",
  });
}
