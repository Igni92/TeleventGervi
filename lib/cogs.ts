/**
 * COGS réel — coût d'entrée marchandise pour le calcul de la MARGE RÉELLE.
 *
 * Directive métier (juin 2026) : « Ne JAMAIS utiliser une valeur de marge
 * provenant de SAP. » La marge est recalculée à partir des documents bruts :
 *
 *   marge réelle = Σ (lineTotal − quantity × coût_EM)   sur les lignes de FACTURES
 *               − Σ (lineTotal − quantity × coût_EM)   sur les lignes d'AVOIRS CLIENTS
 *
 * où `coût_EM` = prix unitaire de la DERNIÈRE entrée marchandise de l'article
 * (SapPdnLine : lineTotal / quantity, quantity > 0, PDN non annulée) dont la
 * date (docDate) est ≤ à la date du document de vente. Fallback : si aucune
 * EM antérieure n'existe, on prend la PREMIÈRE EM connue de l'article (cas
 * des ventes antérieures au début du miroir achats). Si l'article n'a AUCUNE
 * EM, la ligne ne contribue pas à la marge — elle est comptée dans la
 * métrique de couverture (cf. `marginCoverage`), comme l'ancien comportement.
 *
 * Implémentation : jointure LATERAL Postgres (index SapPdnLine.itemCode +
 * SapPurchaseDeliveryNote.docDate) — tous les agrégats restent en GROUP BY
 * SQL, AUCUNE boucle JS sur les lignes. Les colonnes `grossProfit` /
 * `lineCost` (valeurs SAP) restent en base mais ne doivent plus alimenter
 * aucun KPI.
 *
 * Conventions d'alias FIXES pour composer les requêtes :
 *   l    = table de lignes (SapInvoiceLine / SapCreditNoteLine / SapOrderLine)
 *   i    = table d'en-têtes (SapInvoice / SapCreditNote / SapOrder)
 *   cogs = sous-requête LATERAL exposant `cogs."unitCost"`
 */

import { Prisma } from "@prisma/client";

/* ─────────────────────────────────────────────────────────────────
   Fragments SQL
   ───────────────────────────────────────────────────────────────── */

export type SalesDocKind = "invoice" | "creditNote" | "order";

const SALES_DOC_TABLES: Record<SalesDocKind, { header: string; line: string }> = {
  invoice: { header: "SapInvoice", line: "SapInvoiceLine" },
  creditNote: { header: "SapCreditNote", line: "SapCreditNoteLine" },
  order: { header: "SapOrder", line: "SapOrderLine" },
};

/**
 * Fragment FROM complet : lignes `l` + en-tête `i` + LATERAL `cogs`.
 *
 * Usage :
 *   SELECT ..., SUM(${COGS_MARGIN}) FROM ${cogsFromSql("invoice")}
 *   WHERE i."cancelled" = false AND i."docDate" >= ... GROUP BY ...
 *
 * Le LATERAL choisit en UNE passe ordonnée :
 *   1. les EM dont docDate ≤ date du doc de vente, la plus récente d'abord
 *      (à date égale : docEntry/lineNum les plus récents) ;
 *   2. sinon (aucune EM antérieure) la première EM connue de l'article.
 * Les lignes service (itemCode NULL) ne matchent jamais → unitCost NULL.
 */
export function cogsFromSql(kind: SalesDocKind): Prisma.Sql {
  const t = SALES_DOC_TABLES[kind];
  return Prisma.sql`${Prisma.raw(`"${t.line}"`)} l
    JOIN ${Prisma.raw(`"${t.header}"`)} i ON i."docEntry" = l."docEntry"
    LEFT JOIN LATERAL (
      SELECT em."lineTotal" / em."quantity" AS "unitCost"
      FROM "SapPdnLine" em
      JOIN "SapPurchaseDeliveryNote" emh ON emh."docEntry" = em."docEntry"
      WHERE em."itemCode" = l."itemCode"
        AND em."quantity" > 0
        AND emh."cancelled" = false
      ORDER BY (emh."docDate" <= i."docDate") DESC,
               CASE WHEN emh."docDate" <= i."docDate" THEN emh."docDate" END DESC,
               CASE WHEN emh."docDate" >  i."docDate" THEN emh."docDate" END ASC,
               em."docEntry" DESC, em."lineNum" DESC
      LIMIT 1
    ) cogs ON TRUE`;
}

/** Marge réelle d'une ligne (NULL si coût EM inconnu → exclue des SUM). */
export const COGS_MARGIN: Prisma.Sql = Prisma.sql`CASE WHEN cogs."unitCost" IS NOT NULL
  THEN l."lineTotal" - l."quantity" * cogs."unitCost" END`;

/** Expressions de couverture : lignes produit / lignes avec coût EM connu. */
export const COGS_PRODUCT_LINES: Prisma.Sql = Prisma.sql`COUNT(*) FILTER (WHERE l."itemCode" IS NOT NULL)`;
export const COGS_COSTED_LINES: Prisma.Sql = Prisma.sql`COUNT(cogs."unitCost")`;

/* ─────────────────────────────────────────────────────────────────
   Agrégat simple — marge réelle totale d'un type de doc sur une fenêtre.
   ───────────────────────────────────────────────────────────────── */

export interface RealMarginAgg {
  /** Σ (lineTotal − qty × coût EM) sur les lignes dont le coût est connu. */
  margin: number;
  /** Nombre de lignes produit (itemCode non NULL) sur la fenêtre. */
  productLines: number;
  /** Nombre de lignes produit dont le coût EM a été résolu. */
  costedLines: number;
}

/** Marge réelle agrégée d'un type de document de vente sur [start, end[.
 *  `extraWhere` (alias i/l autorisés) permet d'ajouter un filtre (segment…). */
export async function realMarginAgg(
  prisma: { $queryRaw<T>(sql: Prisma.Sql): Promise<T> },
  kind: SalesDocKind,
  start: Date,
  end: Date,
  extraWhere: Prisma.Sql = Prisma.empty,
): Promise<RealMarginAgg> {
  const rows = await prisma.$queryRaw<{ margin: number; n: number; costed: number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(${COGS_MARGIN}), 0)::float AS margin,
           ${COGS_PRODUCT_LINES}::int AS n,
           ${COGS_COSTED_LINES}::int AS costed
    FROM ${cogsFromSql(kind)}
    WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end} ${extraWhere}`);
  const r = rows[0];
  return {
    margin: Number(r?.margin ?? 0),
    productLines: Number(r?.n ?? 0),
    costedLines: Number(r?.costed ?? 0),
  };
}
