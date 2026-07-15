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
   REPLI FABRICATION — coût des articles RECONDITIONNÉS / ASSEMBLÉS.

   Un kit DECO / une barquette n'a PAS de réception d'achat (PDN) directe sous
   son propre code : sa marchandise entre en stock par la FABRICATION (sortie
   des composants achetés + entrée du produit fini). Le coût est donc porté par
   `FabricationRun` : `totalCost` (composants × prix d'achat + main d'œuvre) pour
   `parentColis` colis produits, et `parentValue` (revenu de référence estimé).

   On expose `fab."costRatio" = totalCost / parentValue` = COGS / revenu, un
   ratio en € donc INDÉPENDANT DES UNITÉS (colis / pièce / kg) : le coût d'une
   ligne vendue = `lineTotal × costRatio`. On évite ainsi toute conversion
   d'unité fragile. NULL si l'article n'a aucun run costable.

   ⚠️ Compose APRÈS cogsFromSql(kind) (mêmes alias l, i, cogs) :
       FROM ${'${cogsFromSql("order")} ${FAB_COST_LATERAL}'}
   ───────────────────────────────────────────────────────────────── */

/** LATERAL fabrication — `fab."costRatio"` du run le plus pertinent (done, le
 *  plus récent ≤ date de vente, sinon le plus ancien). Garde-fou anti-aberration :
 *  coût ≤ 2× le revenu de référence (au-delà, `parentValue` est douteux → on
 *  laisse la ligne NON costée plutôt que de polluer la marge). */
export const FAB_COST_LATERAL: Prisma.Sql = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT fr."totalCost" / fr."parentValue" AS "costRatio"
    FROM "FabricationRun" fr
    WHERE fr."parentItemCode" = l."itemCode"
      AND fr."status" = 'done'
      AND fr."totalCost" IS NOT NULL
      AND fr."parentValue" IS NOT NULL AND fr."parentValue" > 0
      AND fr."totalCost" < fr."parentValue" * 2
    ORDER BY (fr."createdAt" <= i."docDate") DESC,
             CASE WHEN fr."createdAt" <= i."docDate" THEN fr."createdAt" END DESC,
             CASE WHEN fr."createdAt" >  i."docDate" THEN fr."createdAt" END ASC,
             fr."createdAt" DESC
    LIMIT 1
  ) fab ON TRUE`;

/** Marge d'une ligne AVEC repli fabrication : coût EM d'abord, sinon coût recette
 *  (`lineTotal × costRatio`). NULL si ni l'un ni l'autre → exclue des SUM. */
export const COGS_MARGIN_FAB: Prisma.Sql = Prisma.sql`CASE
  WHEN cogs."unitCost" IS NOT NULL THEN l."lineTotal" - l."quantity" * cogs."unitCost"
  WHEN fab."costRatio" IS NOT NULL THEN l."lineTotal" * (1 - fab."costRatio")
  END`;

/** Prédicat « ligne costée » (réception EM OU fabrication) — pour les FILTER.
 *  Requiert FAB_COST_LATERAL dans le FROM. */
export const COGS_COSTED_FAB: Prisma.Sql = Prisma.sql`(cogs."unitCost" IS NOT NULL OR fab."costRatio" IS NOT NULL)`;

/* ─────────────────────────────────────────────────────────────────
   MARGE DU JOUR — priorité de coût HYBRIDE (décision métier juillet 2026).

   Constat terrain : le recompute « coût réception » SEUL devient FAUX dès que la
   synchro des réceptions prend du retard — sur de la fraise saisonnière, un coût
   d'hiver (réception de nov.) appliqué à une vente d'été fabrique de fausses
   pertes. Or SAP inscrit déjà sur CHAQUE ligne de BL un coût correct
   (`grossProfit` / `lineCost`), présent ~100 % du temps (= le « pied de BL »).

   Priorité retenue pour la tuile « Marge du jour » (chemin BL/jour UNIQUEMENT) :
     1. coût de la dernière réception RÉCENTE (≤ COGS_FRESH_RECEPTION_DAYS avant la
        vente) — le coût réel d'entrée quand il est frais ;
     2. sinon coût FABRICATION (articles reconditionnés) ;
     3. sinon coût SAP de la ligne (`grossProfit`) — toujours présent, = pied de BL.
   → marge robuste au retard de synchro, ~100 % costée. Validé sur données réelles
     (37,8 % vs 38 % SAP, 0 ligne négative). L'écran comptable (Écran 2, factures)
     N'EST PAS concerné : il reste sur le recompute réception pur (historique audité).
   ───────────────────────────────────────────────────────────────── */

/** Fenêtre (jours) au-delà de laquelle une réception est jugée trop ancienne pour
 *  coster une vente du jour (prix saisonnier périmé) → on retombe sur le coût SAP. */
export const COGS_FRESH_RECEPTION_DAYS = 21;

/** FROM order + LATERAL EM « FRAÎCHE » : coût de la dernière réception de l'article
 *  comprise entre (vente − `days`) et la vente. Au-delà → NULL (repli fab/SAP). */
export function freshCogsOrderFromSql(days: number): Prisma.Sql {
  return Prisma.sql`"SapOrderLine" l
    JOIN "SapOrder" i ON i."docEntry" = l."docEntry"
    LEFT JOIN LATERAL (
      SELECT em."lineTotal" / em."quantity" AS "unitCost"
      FROM "SapPdnLine" em
      JOIN "SapPurchaseDeliveryNote" emh ON emh."docEntry" = em."docEntry"
      WHERE em."itemCode" = l."itemCode"
        AND em."quantity" > 0
        AND emh."cancelled" = false
        AND emh."docDate" <= i."docDate"
        AND emh."docDate" >= i."docDate" - (${days}::int * INTERVAL '1 day')
      ORDER BY emh."docDate" DESC, em."docEntry" DESC, em."lineNum" DESC
      LIMIT 1
    ) cogs ON TRUE`;
}

/** Marge d'une ligne — priorité réception fraîche → fabrication → coût SAP.
 *  Requiert freshCogsOrderFromSql(...) + FAB_COST_LATERAL dans le FROM. */
export const COGS_MARGIN_HYBRID: Prisma.Sql = Prisma.sql`CASE
  WHEN cogs."unitCost" IS NOT NULL THEN l."lineTotal" - l."quantity" * cogs."unitCost"
  WHEN fab."costRatio" IS NOT NULL THEN l."lineTotal" * (1 - fab."costRatio")
  WHEN l."isService" = false AND l."grossProfit" IS NOT NULL THEN l."grossProfit"
  END`;

/** Prédicat « ligne costée » (réception fraîche OU fabrication OU coût SAP). */
export const COGS_COSTED_HYBRID: Prisma.Sql = Prisma.sql`(
  cogs."unitCost" IS NOT NULL OR fab."costRatio" IS NOT NULL
  OR (l."isService" = false AND l."grossProfit" IS NOT NULL))`;

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

/* ─────────────────────────────────────────────────────────────────
   Unité de gestion d'un article — pour la marge moyenne PAR UNITÉ VENDUE.
   RÈGLE ABSOLUE : ne JAMAIS afficher €/colis pour un article géré au kg.
   ───────────────────────────────────────────────────────────────── */

export type UnitKind = "kg" | "colis" | "barquette" | "piece" | "plateau" | "unite";

export interface ManagedUnit {
  kind: UnitKind;
  /** Libellé dynamique pour l'affichage : "kg", "colis", "barquette", "pièce"… */
  label: string;
}

interface ProductUnitFields {
  salesUnit?: string | null;
  inventoryUnit?: string | null;
  salesUnitWeight?: number | null;
  salesQtyPerPackUnit?: number | null;
  salesItemsPerUnit?: number | null;
}

function normUnit(u: string | null | undefined): string {
  return (u ?? "").trim().toLowerCase();
}

function kindOf(u: string): UnitKind | null {
  if (!u) return null;
  if (u === "kg" || u === "kgs" || u.startsWith("kilo") || u.startsWith("kg ")) return "kg";
  if (u.includes("colis") || u === "col") return "colis";
  if (u.startsWith("barq")) return "barquette";
  if (u.startsWith("plat")) return "plateau";
  if (u === "pie" || u === "pc" || u === "pce" || u.startsWith("pièce") || u.startsWith("piece") || u === "u" || u.startsWith("unit")) return "piece";
  return null;
}

const UNIT_LABELS: Record<UnitKind, string> = {
  kg: "kg",
  colis: "colis",
  barquette: "barquette",
  piece: "pièce",
  plateau: "plateau",
  unite: "unité",
};

/**
 * Unité de GESTION réelle de l'article : `inventoryUnit` (unité de stock) en
 * priorité, sinon `salesUnit`. Article géré au kg → marge en €/kg ; au colis
 * → €/colis ; à la barquette → €/barquette ; etc. Unité inconnue → libellé
 * brut SAP (dynamique), jamais un "colis" par défaut.
 */
export function managedUnitOf(p: ProductUnitFields): ManagedUnit {
  const inv = normUnit(p.inventoryUnit);
  const sale = normUnit(p.salesUnit);
  const kind = kindOf(inv) ?? kindOf(sale);
  if (kind) return { kind, label: UNIT_LABELS[kind] };
  const raw = (p.inventoryUnit ?? p.salesUnit ?? "").trim();
  return { kind: "unite", label: raw || "unité" };
}

/**
 * Convertit une quantité FACTURÉE (exprimée en unité de vente) en unités de
 * GESTION pour le dénominateur de la marge moyenne :
 *   - géré au kg      → qty × salesUnitWeight (poids d'une unité de vente, kg) ;
 *   - même unité      → qty telle quelle ;
 *   - unités ≠        → qty × salesItemsPerUnit (NumInSale) ou salesQtyPerPackUnit
 *                       (SalPackUn) quand renseignés (ex. colis de 12 barquettes).
 */
export function unitsSold(qty: number, p: ProductUnitFields, unit: ManagedUnit): number {
  if (unit.kind === "kg") {
    const w = p.salesUnitWeight ?? 0;
    return qty * (w > 0 ? w : 1); // unité de vente déjà en kg si poids inconnu
  }
  const inv = normUnit(p.inventoryUnit);
  const sale = normUnit(p.salesUnit);
  if (!inv || !sale || inv === sale || kindOf(inv) === kindOf(sale)) return qty;
  const perUnit = (p.salesItemsPerUnit ?? 0) > 0 ? p.salesItemsPerUnit!
    : (p.salesQtyPerPackUnit ?? 0) > 0 ? p.salesQtyPerPackUnit!
    : 1;
  return qty * perUnit;
}
