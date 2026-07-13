import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { incrementLocalStock, decrementLocalStock } from "@/lib/stockSync";
import { getRecipe, resolveLotsForItems, packRatio, LOT_PENDING, type LotResolution } from "@/lib/fabrication";
import { quantitesComposant } from "@/lib/fabrication-optim";

/**
 * POST /api/sap/assembly
 *
 * Fabrication d'un produit fini. Deux formats de body :
 *
 * ── v2/v3 (recette par FAMILLE + lot tracé — page /fabrication) ──
 *   {
 *     parentItemCode: "DECO16",
 *     parentColis:    4,                       // multiple de recette.parentQty
 *     warehouseCode:  "01",                    // magasin d'ENTRÉE du produit fini
 *     picks: [{ familyKey: "groseille", itemCode: "GRO12H", warehouseCode: "000" }, …]
 *   }
 *   1 article par famille ; warehouseCode de pick = magasin SOURCE de la sortie
 *   (défaut : le magasin d'entrée) — les composants peuvent donc sortir de
 *   MAGASINS DIFFÉRENTS et le produit fini entrer dans un autre.
 *   Le serveur recalcule TOUT depuis la recette (quantités, lots FIFO, prix) :
 *   les lignes v3 sont en UNITÉS DE BASE (6 barquettes → 0,5 colis de 12 —
 *   les colis peuvent être entamés), les lignes v2 en colis.
 *
 *   Étapes :
 *     1. FabricationRun + lignes enregistrés AVANT l'appel SAP (status=pending).
 *     2. SAP InventoryGenExits (sortie composants, en pie, magasin PAR LIGNE).
 *        Les articles manageBatch portent BatchNumbers [{BatchNumber, Quantity}] ;
 *        pour les autres (cas réel Gervifrais), le lot est posé en U_NoLot par
 *        un PATCH ligne à ligne (même mécanique que /api/sap/goods-receipts).
 *        Un article à découvert porte le sentinel EM_PENDING.
 *     3. SAP InventoryGenEntries (entrée parent dans SON magasin, U_NoLot = code OP).
 *     4. Stock local : décrément composants (par magasin source) + incrément parent.
 *     5. Run complété : status=done + DocEntry/DocNum SAP.
 *
 * ── v1 (legacy ProductBom par article — conservé pour compat) ──
 *   { parentItemCode, packageQuantity, warehouseCode }
 */

const WHITELIST_WHS = new Set(["000", "01", "R1"]);
type SapDoc = { DocEntry: number; DocNum: number };
/** Forme minimale de la session (évite de dépendre des types next-auth v5). */
type Session = { user?: { name?: string | null; email?: string | null } | null };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Coûts/marges réservés aux admins : un commercial fabrique sans voir le coût.
  const admin = (await getAccessScope(session)).all;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  if (Array.isArray(body.picks)) {
    return assemblyV2(body as unknown as V2Body, session, admin);
  }
  return assemblyLegacy(body as unknown as LegacyBody, session, admin);
}

/** Champs de coût/marge — `undefined` pour un non-admin (retirés du JSON). */
function costField<T>(admin: boolean, v: T): T | undefined {
  return admin ? v : undefined;
}

/** Compteur atomique de code d'ordre de production (OP00001, OP00002, …). */
async function nextOpCode(): Promise<string> {
  const opRows = await prisma.$queryRaw<{ value: string }[]>`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ('op_seq', '1', NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = ((("AppSetting"."value")::int + 1)::text), "updatedAt" = NOW()
    RETURNING "value";`;
  return `OP${String(Number(opRows[0]?.value ?? 1)).padStart(5, "0")}`;
}

function userLabel(session: Session): string {
  return session.user?.name ?? session.user?.email ?? "?";
}

/* ══════════════════════════════════════════════════════════════════════
   v2 — run de fabrication avec affectation de lot tracée
   ══════════════════════════════════════════════════════════════════════ */

interface V2Body {
  parentItemCode: string;
  parentColis: number;
  /** Magasin d'ENTRÉE du produit fini. */
  warehouseCode: string;
  /** warehouseCode = magasin SOURCE de la sortie (défaut : magasin d'entrée). */
  picks: { familyKey: string; itemCode: string; warehouseCode?: string }[];
}

async function assemblyV2(body: V2Body, session: Session, admin: boolean) {
  // ── Validation de surface ──
  const parentCode = body.parentItemCode?.trim();
  if (!parentCode) return NextResponse.json({ error: "parentItemCode requis" }, { status: 400 });
  if (!body.parentColis || body.parentColis <= 0) {
    return NextResponse.json({ error: "parentColis > 0 requis" }, { status: 400 });
  }
  if (!body.warehouseCode || !WHITELIST_WHS.has(body.warehouseCode)) {
    return NextResponse.json({ error: `Magasin d'entrée invalide : ${body.warehouseCode}` }, { status: 400 });
  }
  const entryWarehouse = body.warehouseCode;
  for (const p of body.picks ?? []) {
    if (p?.warehouseCode && !WHITELIST_WHS.has(p.warehouseCode)) {
      return NextResponse.json({ error: `Magasin source invalide : ${p.warehouseCode}` }, { status: 400 });
    }
  }

  // ── Recette + ratio « tour » ──
  const recipe = await getRecipe(parentCode);
  if (!recipe || recipe.components.length === 0) {
    return NextResponse.json({ error: `Aucune recette définie pour "${parentCode}".` }, { status: 400 });
  }
  const tours = body.parentColis / recipe.parentQty;
  if (Math.abs(tours - Math.round(tours)) > 1e-9) {
    return NextResponse.json({
      error: `La quantité doit être un multiple de ${recipe.parentQty} colis (1 tour de recette = ${recipe.parentQty} colis de ${parentCode}).`,
    }, { status: 400 });
  }

  // ── Un article (+ magasin source) choisi pour CHAQUE famille de la recette ──
  const pickByFamily = new Map<string, { itemCode: string; warehouse: string }>();
  for (const p of body.picks ?? []) {
    if (p?.familyKey && p?.itemCode) {
      pickByFamily.set(p.familyKey, {
        itemCode: p.itemCode.trim(),
        warehouse: p.warehouseCode || entryWarehouse,
      });
    }
  }
  const missingFams = recipe.components.filter((c) => !pickByFamily.get(c.familyKey));
  if (missingFams.length > 0) {
    return NextResponse.json({
      error: `Article manquant pour : ${missingFams.map((c) => c.familyLabel).join(", ")}.`,
    }, { status: 400 });
  }

  // ── Méta produits (parent + composants choisis) ──
  const pickedCodes = recipe.components.map((c) => (pickByFamily.get(c.familyKey) as { itemCode: string }).itemCode);
  type Meta = {
    itemCode: string; itemName: string; familyKey: string;
    salesUnit: string | null; salesQtyPerPackUnit: number | null; manageBatch: boolean;
  };
  // familyKey calculée par la MÊME règle que FAMILY_CTE_SQL / getFamilyItems
  // (petits fruits par nom, sinon groupe SAP par ID « g_<itemGroup> ») : ainsi la
  // validation d'appartenance famille COÏNCIDE avec la liste des candidats proposés
  // par l'UI. ⚠️ Ne PAS utiliser familyOf() ici : côté JS il retombe sur
  // « g_<groupName> » (le NOM du groupe), qui ne matche jamais un « g_<itemGroup> »
  // — d'où le rejet à tort d'articles pourtant proposés (kiwi & tout non-petit-fruit).
  const metas = await prisma.$queryRawUnsafe<Meta[]>(
    `SELECT "itemCode", "itemName", "salesUnit", "salesQtyPerPackUnit", "manageBatch",
            CASE
              WHEN UPPER("itemName") LIKE '%MYRTILLE%'  THEN 'myrtille'
              WHEN UPPER("itemName") LIKE '%GROSEILLE%' THEN 'groseille'
              WHEN UPPER("itemName") LIKE '%FRAMBOISE%' THEN 'framboise'
              WHEN UPPER("itemName") LIKE '%CASSIS%'    THEN 'cassis'
              WHEN UPPER("itemName") LIKE '%MURE%'
                OR UPPER("itemName") LIKE '%MÛRE%'      THEN 'mure'
              WHEN UPPER("itemName") LIKE '%FRAISE%'    THEN 'fraise'
              ELSE 'g_' || COALESCE("itemGroup"::text, 'na')
            END AS "familyKey"
       FROM "Product" WHERE "itemCode" = ANY($1::text[]);`,
    [parentCode, ...pickedCodes],
  );
  const metaByCode = new Map(metas.map((m) => [m.itemCode, m]));
  const parentMeta = metaByCode.get(parentCode);
  if (!parentMeta) {
    return NextResponse.json({ error: `Parent "${parentCode}" introuvable.` }, { status: 404 });
  }
  for (const code of pickedCodes) {
    if (!metaByCode.get(code)) {
      return NextResponse.json({ error: `Article "${code}" introuvable.` }, { status: 404 });
    }
  }
  // Intégrité : l'article choisi appartient bien à la famille demandée. Clé
  // calculée côté SQL (cf. metas) = même règle que la liste des candidats, donc
  // pas de rejet d'un article que l'UI a pourtant proposé pour cette famille.
  for (const c of recipe.components) {
    const pick = pickByFamily.get(c.familyKey) as { itemCode: string; warehouse: string };
    const m = metaByCode.get(pick.itemCode) as Meta;
    if (m.familyKey !== c.familyKey) {
      return NextResponse.json({
        error: `"${m.itemName}" (${pick.itemCode}) n'appartient pas à la famille ${c.familyLabel}.`,
      }, { status: 400 });
    }
  }

  // ── Lots + prix (serveur = source de vérité), résolus PAR MAGASIN SOURCE ──
  const codesByWhs = new Map<string, string[]>();
  for (const c of recipe.components) {
    const pick = pickByFamily.get(c.familyKey) as { itemCode: string; warehouse: string };
    codesByWhs.set(pick.warehouse, [...(codesByWhs.get(pick.warehouse) ?? []), pick.itemCode]);
  }
  const lotsByWhs = new Map<string, Map<string, LotResolution>>();
  await Promise.all(Array.from(codesByWhs.entries()).map(async ([whs, codes]) => {
    lotsByWhs.set(whs, await resolveLotsForItems(codes, whs));
  }));

  // Dispo par (article, magasin source) — quantité SAP en unités de base.
  const sourceWhs = Array.from(codesByWhs.keys());
  const avails = await prisma.$queryRawUnsafe<{ itemCode: string; warehouse: string; available: number }[]>(
    `SELECT p."itemCode", s."warehouse", COALESCE(s."available", 0) AS "available"
       FROM "Product" p
       JOIN "ProductStock" s ON s."productId" = p."id" AND s."warehouse" = ANY($2::text[])
      WHERE p."itemCode" = ANY($1::text[]);`,
    pickedCodes, sourceWhs,
  );
  const availByCodeWhs = new Map(avails.map((a) => [`${a.itemCode}@${a.warehouse}`, Number(a.available)]));

  type RunLine = {
    family: string; familyLabel: string; itemCode: string; itemName: string;
    warehouse: string; batchNumber: string; pending: boolean; manageBatch: boolean;
    colisQty: number; pieceQty: number; ratio: number;
    priceColis: number | null; lineCost: number | null;
  };
  const runLines: RunLine[] = recipe.components.map((c) => {
    const pick = pickByFamily.get(c.familyKey) as { itemCode: string; warehouse: string };
    const m = metaByCode.get(pick.itemCode) as Meta;
    const ratio = packRatio(m.salesUnit, m.salesQtyPerPackUnit != null ? Number(m.salesQtyPerPackUnit) : null);
    // v3 : qty en unités de base → colis fractionnaires possibles (colis entamés) ;
    // legacy v2 : qty en colis. Conversion unique via quantitesComposant.
    const { pieceQty, colisQty } = quantitesComposant(c.qty, c.mode, tours, ratio);
    const lot = lotsByWhs.get(pick.warehouse)?.get(pick.itemCode);
    const availUnits = availByCodeWhs.get(`${pick.itemCode}@${pick.warehouse}`) ?? 0;
    // À découvert (dispo ≤ 0 dans le magasin source) ou lot introuvable →
    // sentinel EM_PENDING : le lot réel sera propagé à la prochaine entrée marchandise.
    const pending = availUnits <= 0 || !lot?.batchNumber;
    const priceColis = lot?.pricePie != null ? Math.round(lot.pricePie * ratio * 100) / 100 : null;
    return {
      family: c.familyKey,
      familyLabel: c.familyLabel,
      itemCode: pick.itemCode,
      itemName: m.itemName,
      warehouse: pick.warehouse,
      batchNumber: pending ? LOT_PENDING : (lot?.batchNumber as string),
      pending,
      manageBatch: m.manageBatch,
      colisQty,
      pieceQty,
      ratio,
      priceColis,
      lineCost: priceColis != null ? Math.round(priceColis * colisQty * 100) / 100 : null,
    };
  });

  // ── Coût total = composants + lignes de coût de la recette (€/colis fini) ──
  const componentsCost = runLines.reduce((s, l) => s + (l.lineCost ?? 0), 0);
  const recipeCosts = recipe.costs.reduce((s, k) => s + k.costPerColis, 0) * body.parentColis;
  const totalCost = Math.round((componentsCost + recipeCosts) * 100) / 100;

  // Valeur estimée du parent (dernier prix vendu, miroir) — pour la marge.
  const parentRatio = packRatio(parentMeta.salesUnit, parentMeta.salesQtyPerPackUnit != null ? Number(parentMeta.salesQtyPerPackUnit) : null);
  const parentPieceQty = Math.round(body.parentColis * parentRatio * 1000) / 1000;
  const saleRows = await prisma.$queryRawUnsafe<{ lineTotal: number; quantity: number }[]>(
    `SELECT l."lineTotal", l."quantity"
       FROM "SapOrderLine" l JOIN "SapOrder" o ON o."docEntry" = l."docEntry"
      WHERE l."itemCode" = $1 AND o."cancelled" = false AND l."quantity" > 0 AND l."lineTotal" > 0
      ORDER BY o."docDate" DESC, o."docEntry" DESC LIMIT 1;`,
    parentCode,
  );
  const parentValue = saleRows.length > 0 && Number(saleRows[0].quantity) > 0
    ? Math.round((Number(saleRows[0].lineTotal) / Number(saleRows[0].quantity)) * parentRatio * body.parentColis * 100) / 100
    : null;

  // ── Code OP + enregistrement du run AVANT l'appel SAP ──
  const opCode = await nextOpCode();
  const runId = randomUUID();
  // Lot du produit FINI. Si la recette conserve le lot, il HÉRITE du lot EM du
  // composant PRINCIPAL (1er composant avec un lot EM réel, dans l'ordre de la
  // recette) : traçabilité amont + ce lot remonte dans le sélecteur de lots
  // (cf. /api/bons-commande, via FabricationRun.parentBatch), un produit
  // fabriqué n'ayant aucune entrée marchandise à lui. Sinon (ou si aucun
  // composant n'a de lot réel résolu → tout à découvert) : le code OP, comme avant.
  const inheritedLot = recipe.conserveLot
    ? (runLines.find((l) => !l.pending && l.batchNumber && l.batchNumber !== LOT_PENDING)?.batchNumber ?? null)
    : null;
  const parentLot = inheritedLot ?? opCode;
  const snapshot = {
    opCode,
    parentQty: recipe.parentQty,
    tours,
    entryWarehouse,
    components: recipe.components,
    costs: recipe.costs,
    picks: runLines.map((l) => ({
      family: l.family, itemCode: l.itemCode, warehouse: l.warehouse, batchNumber: l.batchNumber,
      colisQty: l.colisQty, pieceQty: l.pieceQty, priceColis: l.priceColis,
    })),
  };
  // Run.warehouseCode = magasin d'ENTRÉE ; chaque ligne porte son magasin SOURCE.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FabricationRun"
       ("id", "opCode", "parentItemCode", "parentItemName", "parentColis", "warehouseCode",
        "recipeSnapshot", "totalCost", "parentValue", "parentBatch", "status", "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'pending', $11);`,
    runId, opCode, parentCode, parentMeta.itemName, body.parentColis, entryWarehouse,
    JSON.stringify(snapshot), totalCost, parentValue, parentLot, userLabel(session),
  );
  for (const l of runLines) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "FabricationRunLine"
         ("id", "runId", "family", "familyLabel", "itemCode", "itemName",
          "batchNumber", "colisQty", "pieceQty", "purchasePrice", "warehouseCode")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
      randomUUID(), runId, l.family, l.familyLabel, l.itemCode, l.itemName,
      l.batchNumber, l.colisQty, l.pieceQty, l.priceColis, l.warehouse,
    );
  }

  const failRun = async (message: string) => {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "FabricationRun" SET "status" = 'error', "error" = $2 WHERE "id" = $1;`,
        runId, message.slice(0, 500),
      );
    } catch { /* le run reste pending — visible dans l'historique */ }
  };

  // ── 1. SAP InventoryGenExits — sortie des composants (avec lots),
  //       chaque ligne depuis SON magasin source ──
  const today = new Date().toISOString().slice(0, 10);
  const exitPayload = {
    DocDate: today,
    Comments: `${opCode} — Fabrication ${body.parentColis} colis ${parentCode} via TeleVent — ${userLabel(session)}`,
    DocumentLines: runLines.map((l) => ({
      ItemCode: l.itemCode,
      Quantity: l.pieceQty,
      WarehouseCode: l.warehouse,
      // Articles batch-managed SAP : collection native (lot réel uniquement).
      ...(l.manageBatch && !l.pending
        ? { BatchNumbers: [{ BatchNumber: l.batchNumber, Quantity: l.pieceQty }] }
        : {}),
    })),
  };
  let exitDoc: SapDoc;
  try {
    exitDoc = await sap.post<SapDoc>("/InventoryGenExits", exitPayload);
    console.log(`[Assembly v2] ✅ ${opCode} Exit SAP DocNum:`, exitDoc.DocNum);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Assembly v2] ❌ ${opCode} InventoryGenExits FAIL:`, message);
    await failRun(`Sortie composants échouée : ${message}`);
    return NextResponse.json({ ok: false, error: `Sortie composants échouée : ${message}` }, { status: 500 });
  }

  // ── 1b. Lot par ligne en U_NoLot (PATCH, comme les BR) — best-effort ──
  try {
    type CreatedLine = { LineNum: number; ItemCode: string };
    const refetch = await sap.get<{ DocumentLines: CreatedLine[] }>(
      `/InventoryGenExits(${exitDoc.DocEntry})?$select=DocumentLines`,
    );
    const lotByCode = new Map(runLines.map((l) => [l.itemCode, l.batchNumber]));
    const patchLines = (refetch.DocumentLines || [])
      .filter((l) => lotByCode.has(l.ItemCode))
      .map((l) => ({ LineNum: l.LineNum, U_NoLot: lotByCode.get(l.ItemCode) }));
    if (patchLines.length > 0) {
      await sap.patch(`InventoryGenExits(${exitDoc.DocEntry})`, { DocumentLines: patchLines });
    }
  } catch (e) {
    console.warn(`[Assembly v2] ${opCode} PATCH U_NoLot exit échoué (non-bloquant):`, (e as Error).message);
  }

  // ── 2. SAP InventoryGenEntries — entrée du parent dans SON magasin ──
  const entryPayload = {
    DocDate: today,
    Comments: `${opCode} — Fabrication ${body.parentColis} colis ${parentCode} (entrée parent, exit#${exitDoc.DocNum})`,
    DocumentLines: [{
      ItemCode: parentCode,
      Quantity: parentPieceQty,
      WarehouseCode: entryWarehouse,
      // Parent batch-managed : lot du produit fini = parentLot (lot EM hérité du
      // composant si la recette conserve le lot, sinon le code OP).
      ...(parentMeta.manageBatch
        ? { BatchNumbers: [{ BatchNumber: parentLot, Quantity: parentPieceQty }] }
        : {}),
    }],
  };
  let entryDoc: SapDoc;
  try {
    entryDoc = await sap.post<SapDoc>("/InventoryGenEntries", entryPayload);
    console.log(`[Assembly v2] ✅ ${opCode} Entry SAP DocNum:`, entryDoc.DocNum);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Assembly v2] ❌ ${opCode} InventoryGenEntries FAIL après Exit OK:`, message);
    await failRun(`Entrée parent échouée APRÈS sortie composants OK (exit#${exitDoc.DocNum}). Corrige dans SAP. ${message}`);
    return NextResponse.json({
      ok: false,
      error: `Entrée parent échouée APRÈS sortie composants OK (exit#${exitDoc.DocNum}). Corrige manuellement dans SAP. Détail: ${message}`,
    }, { status: 500 });
  }

  // ── 2b. Traçabilité : U_NoLot = lot du produit fini (lot EM hérité ou code OP)
  //        sur l'entrée parent — best-effort ──
  try {
    type CreatedLine = { LineNum: number };
    const refetch = await sap.get<{ DocumentLines: CreatedLine[] }>(
      `/InventoryGenEntries(${entryDoc.DocEntry})?$select=DocumentLines`,
    );
    const patchLines = (refetch.DocumentLines || []).map((l) => ({ LineNum: l.LineNum, U_NoLot: parentLot }));
    if (patchLines.length > 0) {
      await sap.patch(`InventoryGenEntries(${entryDoc.DocEntry})`, { DocumentLines: patchLines });
    }
  } catch (e) {
    console.warn(`[Assembly v2] ${opCode} PATCH U_NoLot entry échoué (non-bloquant):`, (e as Error).message);
  }

  // ── 3. Stock local : décrément composants (magasin source par ligne)
  //       + incrément parent (magasin d'entrée) ──
  try {
    await decrementLocalStock(runLines.map((l) => ({
      itemCode: l.itemCode, quantity: l.pieceQty, warehouseCode: l.warehouse,
    })));
    await incrementLocalStock([{ itemCode: parentCode, quantity: parentPieceQty, warehouseCode: entryWarehouse }]);
  } catch (e) {
    console.warn(`[Assembly v2] ${opCode} stockSync échoué (non-bloquant):`, (e as Error).message);
  }

  // ── 4. Run complété ──
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "FabricationRun"
          SET "status" = 'done', "sapExitEntry" = $2, "sapExitDocNum" = $3,
              "sapEntryEntry" = $4, "sapEntryDocNum" = $5
        WHERE "id" = $1;`,
      runId, exitDoc.DocEntry, exitDoc.DocNum, entryDoc.DocEntry, entryDoc.DocNum,
    );
  } catch (e) {
    console.warn(`[Assembly v2] ${opCode} update run échoué:`, (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    opCode,
    runId,
    parent: {
      itemCode: parentCode, itemName: parentMeta.itemName,
      parentColis: body.parentColis, pieceQuantity: parentPieceQty,
    },
    lines: runLines.map((l) => ({
      family: l.familyLabel, itemCode: l.itemCode, itemName: l.itemName,
      warehouse: l.warehouse,
      batchNumber: l.batchNumber, pending: l.pending,
      colisQty: l.colisQty, pieceQty: l.pieceQty,
      priceColis: costField(admin, l.priceColis),
      lineCost: costField(admin, l.lineCost),
    })),
    totalCost: costField(admin, totalCost),
    parentValue: costField(admin, parentValue),
    margin: costField(admin, parentValue != null ? Math.round((parentValue - totalCost) * 100) / 100 : null),
    sapExitDocNum: exitDoc.DocNum,
    sapEntryDocNum: entryDoc.DocNum,
    warehouse: entryWarehouse,
  });
}

/* ══════════════════════════════════════════════════════════════════════
   v1 — legacy ProductBom par article (inchangé)
   ══════════════════════════════════════════════════════════════════════ */

interface LegacyBody {
  parentItemCode: string;
  packageQuantity: number;
  warehouseCode: string;
}

async function assemblyLegacy(body: LegacyBody, session: Session, admin: boolean) {
  if (!body.parentItemCode?.trim()) {
    return NextResponse.json({ error: "parentItemCode requis" }, { status: 400 });
  }
  if (!body.packageQuantity || body.packageQuantity <= 0) {
    return NextResponse.json({ error: "packageQuantity > 0 requis" }, { status: 400 });
  }
  if (!body.warehouseCode || !WHITELIST_WHS.has(body.warehouseCode)) {
    return NextResponse.json({ error: `Entrepôt invalide : ${body.warehouseCode}` }, { status: 400 });
  }
  const parentCode = body.parentItemCode.trim();
  const warehouse = body.warehouseCode;

  // ── Parent : ratio colis→pie ──
  const parent = await prisma.product.findUnique({
    where: { itemCode: parentCode },
    select: { itemCode: true, itemName: true, salesQtyPerPackUnit: true },
  });
  if (!parent) {
    return NextResponse.json({ error: `Parent "${parentCode}" introuvable.` }, { status: 404 });
  }
  const parentRatio = (parent.salesQtyPerPackUnit && parent.salesQtyPerPackUnit > 1)
    ? parent.salesQtyPerPackUnit : 1;
  const parentPieceQty = body.packageQuantity * parentRatio;

  // ── Nomenclature ──
  type BomRow = { componentItemCode: string; itemName: string; qtyPerParent: number; purchasePrice: number | null };
  const components = await prisma.$queryRawUnsafe<BomRow[]>(
    `SELECT b."componentItemCode", b."qtyPerParent", p."itemName",
            (SELECT pb."purchasePrice" FROM "ProductBatch" pb
              WHERE pb."productId" = p."id" AND pb."purchasePrice" IS NOT NULL
              ORDER BY pb."admissionDate" DESC NULLS LAST LIMIT 1) AS "purchasePrice"
       FROM "ProductBom" b
       JOIN "Product" p ON p."itemCode" = b."componentItemCode"
      WHERE b."parentItemCode" = $1`,
    parentCode,
  );
  if (components.length === 0) {
    return NextResponse.json({
      error: `Aucune nomenclature définie pour "${parentCode}". Configure-la via /api/products/bom.`,
    }, { status: 400 });
  }

  // ── Calcul qtés composants + coût total ──
  const resolvedComponents = components.map((c) => {
    const qty = parentPieceQty * c.qtyPerParent;          // en pie composant
    const lineCost = (c.purchasePrice ?? 0) * qty;
    return { ...c, qty, lineCost };
  });
  const totalCost = resolvedComponents.reduce((s, c) => s + c.lineCost, 0);

  const opCode = await nextOpCode();

  // ── SAP InventoryGenExits : sortie composants ──
  const today = new Date().toISOString().slice(0, 10);
  const exitPayload = {
    DocDate: today,
    Comments: `${opCode} — Fabrication ${body.packageQuantity} colis ${parentCode} via TeleVent — ${userLabel(session)}`,
    DocumentLines: resolvedComponents.map((c) => ({
      ItemCode: c.componentItemCode,
      Quantity: c.qty,
      WarehouseCode: warehouse,
    })),
  };

  let exitDoc: SapDoc;
  try {
    exitDoc = await sap.post<SapDoc>("/InventoryGenExits", exitPayload);
    console.log("[Assembly] ✅ Exit SAP DocNum:", exitDoc.DocNum);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Assembly] ❌ InventoryGenExits FAIL:", message);
    return NextResponse.json({ ok: false, error: `Sortie composants échouée : ${message}` }, { status: 500 });
  }

  // ── SAP InventoryGenEntries : entrée parent ──
  const entryPayload = {
    DocDate: today,
    Comments: `${opCode} — Fabrication ${body.packageQuantity} colis ${parentCode} (entrée parent, exit#${exitDoc.DocNum})`,
    DocumentLines: [{
      ItemCode: parentCode,
      Quantity: parentPieceQty,
      WarehouseCode: warehouse,
    }],
  };
  let entryDoc: SapDoc;
  try {
    entryDoc = await sap.post<SapDoc>("/InventoryGenEntries", entryPayload);
    console.log("[Assembly] ✅ Entry SAP DocNum:", entryDoc.DocNum);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Assembly] ❌ InventoryGenEntries FAIL après Exit OK:", message);
    return NextResponse.json({
      ok: false,
      error: `Entrée parent échouée APRÈS sortie composants OK (exit#${exitDoc.DocNum}). Corrige manuellement dans SAP. Détail: ${message}`,
    }, { status: 500 });
  }

  // ── Stock local : décrément composants + incrément parent ──
  try {
    await decrementLocalStock(resolvedComponents.map((c) => ({
      itemCode: c.componentItemCode, quantity: c.qty, warehouseCode: warehouse,
    })));
    await incrementLocalStock([{
      itemCode: parentCode, quantity: parentPieceQty, warehouseCode: warehouse,
    }]);
  } catch (e) {
    console.warn("[Assembly] stockSync échoué (non-bloquant):", (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    opCode,
    parent: { itemCode: parentCode, itemName: parent.itemName, packageQuantity: body.packageQuantity, pieceQuantity: parentPieceQty },
    components: resolvedComponents.map((c) => ({
      itemCode: c.componentItemCode, itemName: c.itemName, qty: c.qty,
      purchasePrice: costField(admin, c.purchasePrice),
      lineCost: costField(admin, Math.round(c.lineCost * 100) / 100),
    })),
    totalCost: costField(admin, Math.round(totalCost * 100) / 100),
    sapExitDocNum: exitDoc.DocNum,
    sapEntryDocNum: entryDoc.DocNum,
    warehouse,
  });
}
