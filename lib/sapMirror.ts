/**
 * SAP Mirror — pull SAP B1 vers les tables SapInvoice / SapOrder / SapPdn / SapBusinessPartner.
 *
 * Utilisé par :
 *   - /api/sap/sync/backfill (one-shot rétrospectif, fenêtre temporelle)
 *   - /api/sap/sync/mirror   (incrémental cron, UpdateDate gt cursor)
 *
 * Choix archi :
 *   - Écritures en BULK raw SQL (modèle : scripts/backfill-docs.mjs) :
 *     en-têtes en INSERT multi-VALUES ON CONFLICT DO UPDATE par lots de 200,
 *     lignes en DELETE WHERE docEntry = ANY(...) + INSERT multi-VALUES,
 *     séquentiel entre lots. Un lot de 200 docs = 3 requêtes SQL au lieu de
 *     3 requêtes PAR doc (l'ancien upsert doc-par-doc en Promise.all ×3
 *     entités a tué le pooler Supabase en EMAXCONNSESSION le 2026-06-11).
 *   - On ignore les docs Cancelled=tYES côté agrégats mais on les garde en base
 *     avec le flag `cancelled=true` (audit + détection annulation tardive).
 */

import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

// ─────────────────────────────────────────────────────────────────
// Types SAP B1 (Service Layer) — minimal subset
// ─────────────────────────────────────────────────────────────────

interface SapDocLine {
  LineNum: number;
  ItemCode: string;
  ItemDescription?: string;
  Quantity?: number;
  LineTotal?: number;        // total HT ligne
  StockPrice?: number;       // prix de revient unitaire (SAP) — utilisé pour la marge
  GrossProfit?: number;
  WarehouseCode?: string;
}

interface SapInvoiceDoc {
  DocEntry: number;
  DocNum?: number;
  DocDate: string;           // ISO
  CardCode: string;
  CardName?: string;
  SalesPersonCode?: number;  // SlpCode — résolu via SalesPersons
  DocTotal?: number;
  VatSum?: number;
  GrossProfit?: number;      // marge SAP (somme lignes)
  Cancelled?: "tYES" | "tNO";
  UpdateDate?: string;
  DocumentLines?: SapDocLine[];
}

interface SapBP {
  CardCode: string;
  CardName: string;
  CardType: "cCustomer" | "cSupplier" | "cLid";
  GroupCode?: number;
  SalesPersonCode?: number;
  EmailAddress?: string;
  Phone1?: string;
  Valid?: "tYES" | "tNO";
  // Risque crédit : plafond, solde courant, gel du compte.
  CreditLimit?: number;
  CurrentAccountBalance?: number;
  Frozen?: "tYES" | "tNO";
  UpdateDate?: string;
}

interface SapSalesPerson { SalesEmployeeCode: number; SalesEmployeeName: string }

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

// ⚠️ Deux contraintes de CE Service Layer (vérifiées via scripts/diag-*.mjs) :
//  1. Pas de `$expand` sur DocumentLines (« Cannot expand invalid navigation
//     property » / « invalid expand ») → on met `DocumentLines` DANS le
//     `$select`, SANS `$expand` (convention déjà utilisée ailleurs dans le code).
//  2. `GrossProfit` N'EXISTE PAS en en-tête (« Property 'GrossProfit' of
//     'Document' is invalid »), ni sur Invoices ni sur Orders — il n'existe
//     qu'au niveau LIGNE. La marge du document est donc recalculée au mapping
//     = Σ (ligne.GrossProfit).  ⇒ aucun `GrossProfit` dans les selects ci-dessous.
const COMMON_SELECT_DOC =
  "DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate";
const SELECT_DOC_LINES = `$select=${COMMON_SELECT_DOC},DocumentLines`;

// PDN n'a pas SalesPersonCode utile → select trimmed
const SELECT_PDN_LINES =
  "$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled,UpdateDate,DocumentLines";

function odataDate(d: Date): string {
  // ⚠️ CE Service Layer exige la date QUOTÉE dans $filter : `DocDate ge '2025-06-11'`.
  // Sans quotes → 400 « the given value('2025') of property 'DocDate' is of
  // invalid datetime format ». Vérifié via scripts/diag-datefmt.mjs (même
  // convention que goods-receipts qui marche en prod : DocDate eq '${today}').
  return `'${d.toISOString().slice(0, 10)}'`;
}

function cardTypeChar(t: SapBP["CardType"]): "C" | "V" {
  return t === "cSupplier" ? "V" : "C";
}

// ─────────────────────────────────────────────────────────────────
// Écritures BULK (modèle : scripts/backfill-docs.mjs).
//
// Pourquoi pas Prisma upsert ? Pool Supabase session mode = 15 clients max,
// et le full-reset lance 4 entités en parallèle : l'upsert doc-par-doc
// (3 requêtes/doc × Promise.all) sature le pooler (EMAXCONNSESSION vécu).
// Ici : 1 lot de 200 docs = 1 INSERT en-têtes + 1 DELETE lignes + n INSERT
// lignes, le tout séquentiel → ~75 requêtes pour 6 757 docs (mesuré).
// ─────────────────────────────────────────────────────────────────

const DOC_BATCH = 200;          // docs par lot (en-têtes + lignes en ~3 requêtes bulk)
const MAX_SQL_PARAMS = 60_000;  // marge sous la limite Postgres (~65 535 paramètres)

// Colonnes des docs de vente (Invoices / Orders / CreditNotes) — ordre = ordre
// des valeurs construites dans pullSalesDocs. `syncedAt` est ajouté en NOW().
const SALES_HEADER_COLS = [
  "docEntry", "docNum", "docDate", "cardCode", "cardName", "slpName",
  "docTotal", "vatSum", "grossProfit", "cancelled", "updateDate",
] as const;
const SALES_LINE_COLS = [
  "docEntry", "lineNum", "itemCode", "itemDescription", "quantity",
  "lineTotal", "lineCost", "grossProfit", "warehouseCode", "isService",
] as const;

// Colonnes PDN (pas de slpName / vatSum / grossProfit / lineCost).
const PDN_HEADER_COLS = [
  "docEntry", "docNum", "docDate", "cardCode", "cardName",
  "docTotal", "cancelled", "updateDate",
] as const;
const PDN_LINE_COLS = [
  "docEntry", "lineNum", "itemCode", "itemDescription", "quantity",
  "lineTotal", "warehouseCode",
] as const;

interface MappedDoc {
  docEntry: number;
  header: unknown[];   // valeurs dans l'ordre de headerCols
  lines: unknown[][];  // valeurs dans l'ordre de lineCols
}

/**
 * Upsert bulk d'un ensemble de documents (en-têtes + lignes), par lots de
 * DOC_BATCH. Idempotent : ON CONFLICT (docEntry) DO UPDATE pour les en-têtes,
 * DELETE + INSERT pour les lignes (reset complet, comme avant).
 */
async function bulkUpsertDocs(opts: {
  headerTable: string;
  lineTable: string;
  headerCols: readonly string[];
  lineCols: readonly string[];
  docs: MappedDoc[];
}): Promise<void> {
  const { headerTable, lineTable, headerCols, lineCols, docs } = opts;
  if (docs.length === 0) return;

  const updateSet = headerCols
    .filter((c) => c !== "docEntry")
    .map((c) => `"${c}"=EXCLUDED."${c}"`)
    .join(",");

  for (let i = 0; i < docs.length; i += DOC_BATCH) {
    const slice = docs.slice(i, i + DOC_BATCH);

    // ── 1 requête bulk : upsert des en-têtes du lot ──
    const hValues: string[] = [];
    const hParams: unknown[] = [];
    let hp = 1;
    for (const d of slice) {
      hValues.push(`(${d.header.map(() => `$${hp++}`).join(",")},NOW())`);
      hParams.push(...d.header);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${headerTable}" (${headerCols.map((c) => `"${c}"`).join(",")},"syncedAt")
       VALUES ${hValues.join(",")}
       ON CONFLICT ("docEntry") DO UPDATE SET ${updateSet},"syncedAt"=NOW()`,
      ...hParams,
    );

    // ── 1 DELETE + n INSERT bulk pour les lignes du lot ──
    const entries = slice.map((d) => d.docEntry);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${lineTable}" WHERE "docEntry" = ANY($1::int[])`,
      entries,
    );

    const allLines = slice.flatMap((d) => d.lines);
    if (allLines.length > 0) {
      // Limite Postgres ~65k paramètres → sous-lots de lignes.
      const maxRows = Math.floor(MAX_SQL_PARAMS / lineCols.length);
      for (let j = 0; j < allLines.length; j += maxRows) {
        const ls = allLines.slice(j, j + maxRows);
        const values: string[] = [];
        const params: unknown[] = [];
        let p = 1;
        for (const row of ls) {
          values.push(`(${row.map(() => `$${p++}`).join(",")})`);
          params.push(...row);
        }
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${lineTable}" (${lineCols.map((c) => `"${c}"`).join(",")})
           VALUES ${values.join(",")}
           ON CONFLICT ("docEntry","lineNum") DO NOTHING`,
          ...params,
        );
      }
    }
  }
}

/**
 * Ensure-BP minimal : crée les BusinessPartners manquants AVANT l'insert des
 * docs (FK cardCode). On insère le minimum (cardCode + cardName) ; le vrai
 * pull BP complétera groupe/commercial/email au tick suivant.
 */
async function ensureBusinessPartners(
  docs: { CardCode: string; CardName?: string }[],
  cardType: "C" | "V",
): Promise<void> {
  const needBp = Array.from(new Set(docs.map((d) => d.CardCode)));
  if (needBp.length === 0) return;
  const existing = await prisma.sapBusinessPartner.findMany({
    where: { cardCode: { in: needBp } },
    select: { cardCode: true },
  });
  const existingSet = new Set(existing.map((e) => e.cardCode));
  const missing = needBp.filter((c) => !existingSet.has(c));
  if (missing.length > 0) {
    await prisma.sapBusinessPartner.createMany({
      data: missing.map((cardCode) => {
        const sample = docs.find((d) => d.CardCode === cardCode)!;
        return {
          cardCode,
          cardName: sample.CardName ?? cardCode,
          cardType,
          active: true,
        };
      }),
      skipDuplicates: true,
    });
  }
}

/** Dédoublonne par docEntry (la pagination $skip peut renvoyer un doc deux
 *  fois si la collection bouge entre deux pages — un doublon dans un même
 *  INSERT multi-VALUES ferait échouer le ON CONFLICT DO UPDATE). */
function dedupeByDocEntry<T extends { DocEntry: number }>(docs: T[]): T[] {
  const byEntry = new Map<number, T>();
  for (const d of docs) byEntry.set(d.DocEntry, d); // dernier vu = plus frais
  return Array.from(byEntry.values());
}

// ─────────────────────────────────────────────────────────────────
// BusinessPartners — référentiel clients + fournisseurs.
// Doit être pull AVANT les docs (FK CardCode).
// ─────────────────────────────────────────────────────────────────

const BP_COLS = [
  "cardCode", "cardName", "cardType", "groupCode", "groupName",
  "slpName", "email", "phone", "active",
  "creditLimit", "currentAccountBalance", "frozen",
  "updateDate",
] as const;

export async function pullBusinessPartners(opts: {
  updatedSince?: Date;
} = {}): Promise<{ pulled: number; upserted: number }> {
  // BusinessPartnerGroups (groupes CLIENTS) = Code/Name dans le Service Layer
  // (≠ ItemGroups = Number/GroupName). L'ancien select Number/GroupName échouait
  // → groupes clients jamais résolus (cause des sapGroupName vides).
  const groups = await sap.getAll<{ Code: number; Name: string }>("BusinessPartnerGroups?$select=Code,Name", { env: "prod" });
  const groupNameById = new Map(groups.map((g) => [g.Code, g.Name]));

  const slps = await sap.getAll<SapSalesPerson>(
    "SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName",
    { env: "prod" },
  );
  const slpNameByCode = new Map(slps.map((s) => [s.SalesEmployeeCode, s.SalesEmployeeName]));

  let path =
    "BusinessPartners?$select=CardCode,CardName,CardType,GroupCode,SalesPersonCode,EmailAddress,Phone1,Valid,CreditLimit,CurrentAccountBalance,Frozen,UpdateDate"
    + "&$filter=(CardType eq 'cCustomer' or CardType eq 'cSupplier')";
  if (opts.updatedSince) {
    // `ge` et pas `gt` : UpdateDate tronqué au jour (cf. commentaire pullSalesDocs).
    path += ` and UpdateDate ge ${odataDate(opts.updatedSince)}`;
  }

  const rawBps = await sap.getAll<SapBP>(path, { pageSize: 500, maxPages: 100, env: "prod" });
  // Dédoublonnage CardCode (même raison que dedupeByDocEntry).
  const byCode = new Map<string, SapBP>();
  for (const bp of rawBps) byCode.set(bp.CardCode, bp);
  const bps = Array.from(byCode.values());

  // Upsert BULK : 1 INSERT multi-VALUES ON CONFLICT DO UPDATE par lot de 200
  // (avant : 1 upsert Prisma PAR BP en Promise.all ×50 → pooler saturé).
  const updateSet = BP_COLS
    .filter((c) => c !== "cardCode")
    .map((c) => `"${c}"=EXCLUDED."${c}"`)
    .join(",");

  let upserted = 0;
  for (let i = 0; i < bps.length; i += DOC_BATCH) {
    const slice = bps.slice(i, i + DOC_BATCH);
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const bp of slice) {
      const row = [
        bp.CardCode,
        bp.CardName || bp.CardCode,
        cardTypeChar(bp.CardType),
        bp.GroupCode ?? null,
        bp.GroupCode != null ? groupNameById.get(bp.GroupCode) ?? null : null,
        bp.SalesPersonCode != null ? slpNameByCode.get(bp.SalesPersonCode) ?? null : null,
        bp.EmailAddress ?? null,
        bp.Phone1 ?? null,
        bp.Valid !== "tNO",
        bp.CreditLimit ?? null,
        bp.CurrentAccountBalance ?? null,
        bp.Frozen === "tYES",
        bp.UpdateDate ? new Date(bp.UpdateDate) : null,
      ];
      values.push(`(${row.map(() => `$${p++}`).join(",")},NOW())`);
      params.push(...row);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SapBusinessPartner" (${BP_COLS.map((c) => `"${c}"`).join(",")},"syncedAt")
       VALUES ${values.join(",")}
       ON CONFLICT ("cardCode") DO UPDATE SET ${updateSet},"syncedAt"=NOW()`,
      ...params,
    );
    upserted += slice.length;
  }

  return { pulled: rawBps.length, upserted };
}

// ─────────────────────────────────────────────────────────────────
// Propagation SapBusinessPartner → Client.sapGroupCode / sapGroupName.
// Le pull miroir alimente SapBusinessPartner ; cette fonction copie le
// groupe SAP (cardType='C') dans la fiche Client locale (match par code
// = CardCode). Idempotent : seulement les lignes qui diffèrent vraiment
// (IS DISTINCT FROM gère NULL). Pré-requis de la flèche "familles vs
// groupe" sur la fiche client (cf. backlog-features-batch2).
// ─────────────────────────────────────────────────────────────────
export async function syncClientGroupsFromMirror(): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "Client" AS c
    SET "sapGroupCode" = bp."groupCode",
        "sapGroupName" = bp."groupName",
        "updatedAt"    = NOW()
    FROM "SapBusinessPartner" AS bp
    WHERE bp."cardCode" = c."code"
      AND bp."cardType" = 'C'
      AND (
        c."sapGroupCode" IS DISTINCT FROM bp."groupCode" OR
        c."sapGroupName" IS DISTINCT FROM bp."groupName"
      );
  `;
  return { updated };
}

// ─────────────────────────────────────────────────────────────────
// Pull générique d'un type de document (Invoice / Order / CreditNote).
// Retourne le nombre de docs traités + le max UpdateDate vu.
// ─────────────────────────────────────────────────────────────────

/** Options de pull : borne basse `from` et/ou haute `to` (DocDate), ou
 *  `updatedSince` (incrémental). `to` permet de découper un gros backfill
 *  historique en tranches (anti-timeout). */
type MirrorPullOpts = { from?: Date; to?: Date; updatedSince?: Date };

type Endpoint = "Invoices" | "Orders" | "CreditNotes";

const SALES_TABLES: Record<Endpoint, { header: string; line: string }> = {
  Invoices: { header: "SapInvoice", line: "SapInvoiceLine" },
  Orders: { header: "SapOrder", line: "SapOrderLine" },
  CreditNotes: { header: "SapCreditNote", line: "SapCreditNoteLine" },
};

async function pullSalesDocs(
  endpoint: Endpoint,
  opts: MirrorPullOpts,
): Promise<{ pulled: number; maxUpdate: Date | null }> {
  const filters: string[] = [];
  if (opts.from) filters.push(`DocDate ge ${odataDate(opts.from)}`);
  if (opts.to) filters.push(`DocDate le ${odataDate(opts.to)}`);
  // ⚠️ `ge` (≥) et pas `gt` : SAP UpdateDate est tronqué au JOUR (pas d'heure).
  // Avec `gt`, dès que le curseur atteint aujourd'hui, tous les docs du jour
  // même sont exclus (UpdateDate gt 2026-06-11 = faux pour un doc du 2026-06-11)
  // → on rate les commandes/factures/réceptions passées aujourd'hui. `ge`
  // re-scanne le jour courant (upsert idempotent) et rattrape les nouveaux docs.
  if (opts.updatedSince) filters.push(`UpdateDate ge ${odataDate(opts.updatedSince)}`);
  const filter = filters.length ? `&$filter=${filters.join(" and ")}` : "";

  const path = `${endpoint}?${SELECT_DOC_LINES}${filter}&$orderby=DocEntry asc`;

  const docs = dedupeByDocEntry(
    await sap.getAll<SapInvoiceDoc>(path, { pageSize: 100, maxPages: 100, env: "prod" }),
  );
  if (docs.length === 0) return { pulled: 0, maxUpdate: null };

  // Ensure BP exists for each cardCode — on insère le minimum si manquant.
  await ensureBusinessPartners(docs, "C");

  // Résolution commercial (SalesPersonCode → name) — cache local
  const slps = await sap.getAll<SapSalesPerson>(
    "SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName",
    { env: "prod" },
  );
  const slpNameByCode = new Map(slps.map((s) => [s.SalesEmployeeCode, s.SalesEmployeeName]));

  // ── Mapping (identique à l'ancienne version doc-par-doc) ──
  let maxUpdate: Date | null = null;
  const mapped: MappedDoc[] = docs.map((d) => {
    const docTotal = d.DocTotal ?? 0;
    const vatSum = d.VatSum ?? 0;
    const slpName = d.SalesPersonCode != null && d.SalesPersonCode >= 0
      ? slpNameByCode.get(d.SalesPersonCode) ?? null
      : null;
    const upd = d.UpdateDate ? new Date(d.UpdateDate) : null;
    if (upd && (!maxUpdate || upd > maxUpdate)) maxUpdate = upd;

    let docGrossProfit = 0;
    const lines: unknown[][] = (d.DocumentLines ?? []).map((l) => {
      const qty = l.Quantity ?? 0;
      const lineTotal = l.LineTotal ?? 0;
      const gp = l.GrossProfit ?? null;
      // `StockPrice` n'existe pas sur ce Service Layer → on dérive le coût
      // unitaire depuis la marge ligne : coût = (LineTotal − GrossProfit)/qté.
      // Ainsi (lineTotal − qty × lineCost) == GrossProfit (cohérent Écran 1).
      const lineCost = l.StockPrice ?? (gp != null && qty > 0 ? (lineTotal - gp) / qty : null);
      docGrossProfit += gp ?? 0;
      // Ordre = SALES_LINE_COLS. isService : ligne sans ItemCode = prestation/
      // location/refacturation (convention prisma/schema.prisma).
      return [
        d.DocEntry, l.LineNum, l.ItemCode ?? null, l.ItemDescription ?? null,
        qty, lineTotal, lineCost, gp, l.WarehouseCode ?? null, l.ItemCode == null,
      ];
    });

    // Ordre = SALES_HEADER_COLS.
    // GrossProfit n'existe pas en en-tête SAP → marge document = Σ marge lignes.
    // docTotal stocké HT côté agrégat CA (= DocTotal − VatSum).
    const header: unknown[] = [
      d.DocEntry, d.DocNum ?? null, new Date(d.DocDate), d.CardCode, d.CardName ?? null,
      slpName, docTotal - vatSum, vatSum, docGrossProfit,
      d.Cancelled === "tYES", upd,
    ];
    return { docEntry: d.DocEntry, header, lines };
  });

  await bulkUpsertDocs({
    headerTable: SALES_TABLES[endpoint].header,
    lineTable: SALES_TABLES[endpoint].line,
    headerCols: SALES_HEADER_COLS,
    lineCols: SALES_LINE_COLS,
    docs: mapped,
  });

  return { pulled: docs.length, maxUpdate };
}

export const pullInvoices = (opts: MirrorPullOpts) =>
  pullSalesDocs("Invoices", opts);

export const pullOrders = (opts: MirrorPullOpts) =>
  pullSalesDocs("Orders", opts);

/** Avoirs clients (CreditNotes) → SapCreditNote. Nécessaire au CA NET (factures − avoirs). */
export const pullCreditNotes = (opts: MirrorPullOpts) =>
  pullSalesDocs("CreditNotes", opts);

// ─────────────────────────────────────────────────────────────────
// Documents d'ACHAT — PurchaseDeliveryNotes (entrées fournisseur) et
// PurchaseReturns (avoirs/retours fournisseurs). Mêmes colonnes, même
// mapping (pas de slpName / vatSum / grossProfit / lineCost).
// ─────────────────────────────────────────────────────────────────

interface SapPdnDoc {
  DocEntry: number;
  DocNum?: number;
  DocDate: string;
  CardCode: string;
  CardName?: string;
  DocTotal?: number;
  Cancelled?: "tYES" | "tNO";
  UpdateDate?: string;
  DocumentLines?: SapDocLine[];
}

async function pullPurchaseDocs(
  endpoint: "PurchaseDeliveryNotes" | "PurchaseReturns",
  tables: { header: string; line: string },
  opts: MirrorPullOpts,
): Promise<{ pulled: number; maxUpdate: Date | null }> {
  const filters: string[] = [];
  if (opts.from) filters.push(`DocDate ge ${odataDate(opts.from)}`);
  if (opts.to) filters.push(`DocDate le ${odataDate(opts.to)}`);
  // ⚠️ `ge` (≥) et pas `gt` : SAP UpdateDate est tronqué au JOUR (pas d'heure).
  // Avec `gt`, dès que le curseur atteint aujourd'hui, tous les docs du jour
  // même sont exclus (UpdateDate gt 2026-06-11 = faux pour un doc du 2026-06-11)
  // → on rate les commandes/factures/réceptions passées aujourd'hui. `ge`
  // re-scanne le jour courant (upsert idempotent) et rattrape les nouveaux docs.
  if (opts.updatedSince) filters.push(`UpdateDate ge ${odataDate(opts.updatedSince)}`);
  const filter = filters.length ? `&$filter=${filters.join(" and ")}` : "";

  const path = `${endpoint}?${SELECT_PDN_LINES}${filter}&$orderby=DocEntry asc`;
  const docs = dedupeByDocEntry(
    await sap.getAll<SapPdnDoc>(path, { pageSize: 100, maxPages: 100, env: "prod" }),
  );
  if (docs.length === 0) return { pulled: 0, maxUpdate: null };

  // BP fournisseur — créer le minimum si manquant
  await ensureBusinessPartners(docs, "V");

  // ── Mapping (identique à l'ancienne version doc-par-doc) ──
  let maxUpdate: Date | null = null;
  const mapped: MappedDoc[] = docs.map((d) => {
    const upd = d.UpdateDate ? new Date(d.UpdateDate) : null;
    if (upd && (!maxUpdate || upd > maxUpdate)) maxUpdate = upd;

    // Ordre = PDN_LINE_COLS
    const lines: unknown[][] = (d.DocumentLines ?? []).map((l) => [
      d.DocEntry, l.LineNum, l.ItemCode ?? null, l.ItemDescription ?? null,
      l.Quantity ?? 0, l.LineTotal ?? 0, l.WarehouseCode ?? null,
    ]);

    // Ordre = PDN_HEADER_COLS
    const header: unknown[] = [
      d.DocEntry, d.DocNum ?? null, new Date(d.DocDate), d.CardCode, d.CardName ?? null,
      d.DocTotal ?? 0, d.Cancelled === "tYES", upd,
    ];
    return { docEntry: d.DocEntry, header, lines };
  });

  await bulkUpsertDocs({
    headerTable: tables.header,
    lineTable: tables.line,
    headerCols: PDN_HEADER_COLS,
    lineCols: PDN_LINE_COLS,
    docs: mapped,
  });

  return { pulled: docs.length, maxUpdate };
}

export const pullPdns = (opts: MirrorPullOpts) =>
  pullPurchaseDocs("PurchaseDeliveryNotes", { header: "SapPurchaseDeliveryNote", line: "SapPdnLine" }, opts);

/** Avoirs fournisseurs (PurchaseReturns) → SapPurchaseReturn.
 *  Nécessaire aux Achats NET (= Σ PDN − Σ retours) — curseur : lastPurchaseReturnUpdate. */
export const pullPurchaseReturns = (opts: MirrorPullOpts) =>
  pullPurchaseDocs("PurchaseReturns", { header: "SapPurchaseReturn", line: "SapPurchaseReturnLine" }, opts);
