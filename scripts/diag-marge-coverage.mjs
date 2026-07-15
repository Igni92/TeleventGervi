/**
 * DIAG — pourquoi la « Marge du jour » et la « fiabilité » sont basses.
 *
 * Reproduit EN SQL DIRECT (contre le miroir Postgres) la logique EXACTE de
 * lib/cogs.ts + lib/pilotage.ts (aggregateActivity + salesReceptionCoverage),
 * puis DÉCOMPOSE le CA produit du jour pour montrer POURQUOI une part n'est pas
 * costée / pas « reçue » :
 *
 *   - CA produit total (BL, isService=false)
 *   - CA COSTÉ (ligne rapprochée d'une réception PDN par itemCode) + marge %
 *   - Fiabilité « stock propre » (salesReceptionCoverage)
 *   - TOP articles NON costés par CA, avec le motif :
 *       • aucune EM (jamais reçu sous ce code)  → mismatch code OU reconditionné
 *       • kit / recette / BoM                    → coût = composants (pas de PDN direct)
 *   - Parmi les articles COSTÉS : unité de vente ≠ unité d'achat (marge suspecte)
 *
 * Lecture seule — ne modifie RIEN.
 *   Usage : node scripts/diag-marge-coverage.mjs [YYYY-MM-DD]   (défaut : aujourd'hui)
 *
 * Modèle de connexion : cf. scripts/verif-stats.mjs (pool Supabase, limit=2).
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) ──
const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\\$/g, "$");
  }
}
const g = (k) => process.env[k] ?? env[k] ?? "";
const dbUrl = (() => {
  const u = g("DATABASE_URL");
  if (!u) return undefined;
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

const eur = (n) => (n == null ? "—" : Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €");
const pct = (n) => (n == null ? "—" : Number(n).toFixed(1) + " %");

// Jour ciblé : [DAY, DAY+1[. Défaut = aujourd'hui (heure locale du process).
const DAY = process.argv[2] || new Date().toISOString().slice(0, 10);
const NEXT = (() => { const d = new Date(DAY + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const RECEPTION_LOOKBACK_DAYS = 8; // = lib/pilotage.ts
const RECV_START = (() => { const d = new Date(DAY + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - RECEPTION_LOOKBACK_DAYS); return d.toISOString().slice(0, 10); })();

// FROM + LATERAL EM — copie fidèle de cogsFromSql("order") (lib/cogs.ts).
const COGS_FROM = `
  "SapOrderLine" l
  JOIN "SapOrder" i ON i."docEntry" = l."docEntry"
  LEFT JOIN LATERAL (
    SELECT em."lineTotal" / em."quantity" AS "unitCost"
    FROM "SapPdnLine" em
    JOIN "SapPurchaseDeliveryNote" emh ON emh."docEntry" = em."docEntry"
    WHERE em."itemCode" = l."itemCode" AND em."quantity" > 0 AND emh."cancelled" = false
    ORDER BY (emh."docDate" <= i."docDate") DESC,
             CASE WHEN emh."docDate" <= i."docDate" THEN emh."docDate" END DESC,
             CASE WHEN emh."docDate" >  i."docDate" THEN emh."docDate" END ASC,
             em."docEntry" DESC, em."lineNum" DESC
    LIMIT 1
  ) cogs ON TRUE`;

async function main() {
  console.log(`\n=== DIAG marge/fiabilité — jour ${DAY} (BL / SapOrder) ===\n`);

  // ── 1. Totaux du jour (= aggregateActivity, version corrigée) ──
  const [tot] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(SUM(l."lineTotal") FILTER (WHERE l."isService" = false), 0)::float8 AS ca_all_product,
      COALESCE(SUM(l."lineTotal") FILTER (WHERE cogs."unitCost" IS NOT NULL), 0)::float8 AS ca_costed,
      COALESCE(SUM(CASE WHEN cogs."unitCost" IS NOT NULL
                        THEN l."lineTotal" - l."quantity" * cogs."unitCost" END), 0)::float8 AS margin,
      COUNT(*) FILTER (WHERE l."itemCode" IS NOT NULL)::int AS product_lines,
      COUNT(cogs."unitCost")::int AS costed_lines
    FROM ${COGS_FROM}
    WHERE i."cancelled" = false AND i."docDate" >= $1::date AND i."docDate" < $2::date
  `, DAY, NEXT);

  const caAll = tot.ca_all_product, caCosted = tot.ca_costed, margin = tot.margin;
  const margePctCosted = caCosted > 0 ? (100 * margin) / caCosted : null;   // = tuile (corrigée)
  const margePctAll = caAll > 0 ? (100 * margin) / caAll : null;            // = ancienne tuile (buggée)
  const covPct = caAll > 0 ? (100 * caCosted) / caAll : null;

  console.log("— Base marge —");
  console.log(`  CA produit total (BL)        : ${eur(caAll)}`);
  console.log(`  CA COSTÉ (rapproché EM)       : ${eur(caCosted)}  (${pct(covPct)} du CA produit)`);
  console.log(`  Marge € (lignes costées)      : ${eur(margin)}`);
  console.log(`  Marge % / CA COSTÉ  (tuile)   : ${pct(margePctCosted)}   ← valeur affichée`);
  console.log(`  Marge % / CA total  (ancien)  : ${pct(margePctAll)}   ← ancien calcul (buggé)`);
  console.log(`  Lignes produit : ${tot.product_lines} · costées : ${tot.costed_lines}`);

  // ── 2. Fiabilité « stock propre » (= salesReceptionCoverage) ──
  const [fia] = await prisma.$queryRawUnsafe(`
    WITH sold AS (
      SELECT l."itemCode" AS code, SUM(l."quantity")::float8 AS qty, SUM(l."lineTotal")::float8 AS ca
      FROM "SapOrderLine" l JOIN "SapOrder" i ON i."docEntry" = l."docEntry"
      WHERE i."cancelled" = false AND l."isService" = false AND l."itemCode" IS NOT NULL
        AND i."docDate" >= $1::date AND i."docDate" < $2::date
      GROUP BY l."itemCode"
    ), recv AS (
      SELECT em."itemCode" AS code, SUM(em."quantity")::float8 AS qty
      FROM "SapPdnLine" em JOIN "SapPurchaseDeliveryNote" emh ON emh."docEntry" = em."docEntry"
      WHERE emh."cancelled" = false AND em."itemCode" IS NOT NULL
        AND emh."docDate" >= $3::date AND emh."docDate" < $2::date
      GROUP BY em."itemCode"
    )
    SELECT COALESCE(SUM(sold.ca), 0)::float8 AS ca_total,
           COALESCE(SUM(sold.ca * LEAST(1, COALESCE(recv.qty, 0) / NULLIF(sold.qty, 0))), 0)::float8 AS ca_covered
    FROM sold LEFT JOIN recv ON recv.code = sold.code
  `, DAY, NEXT, RECV_START);
  const fiaPct = fia.ca_total > 0 ? (100 * fia.ca_covered) / fia.ca_total : null;
  console.log(`\n— Fiabilité « stock propre » (réceptions ${RECEPTION_LOOKBACK_DAYS} j) —`);
  console.log(`  ${pct(fiaPct)}  (CA reçu ${eur(fia.ca_covered)} / CA ${eur(fia.ca_total)})`);

  // ── 3. TOP articles NON costés (motif du gap) ──
  const uncov = await prisma.$queryRawUnsafe(`
    WITH sold AS (
      SELECT l."itemCode" AS code, SUM(l."lineTotal")::float8 AS ca, SUM(l."quantity")::float8 AS qty
      FROM "SapOrderLine" l JOIN "SapOrder" i ON i."docEntry" = l."docEntry"
      WHERE i."cancelled" = false AND l."isService" = false AND l."itemCode" IS NOT NULL
        AND i."docDate" >= $1::date AND i."docDate" < $2::date
      GROUP BY l."itemCode"
    )
    SELECT s.code, s.ca, s.qty,
           p."itemName", p."isKit", p."salesUnit", p."purchaseUnit", p."inventoryUnit",
           EXISTS(SELECT 1 FROM "SapPdnLine" em WHERE em."itemCode" = s.code AND em."quantity" > 0) AS has_pdn,
           EXISTS(SELECT 1 FROM "ProductBom" b WHERE b."parentItemCode" = s.code) AS has_bom,
           EXISTS(SELECT 1 FROM "ProductionRecipe" r WHERE r."parentItemCode" = s.code) AS has_recipe
    FROM sold s LEFT JOIN "Product" p ON p."itemCode" = s.code
    WHERE NOT EXISTS(SELECT 1 FROM "SapPdnLine" em WHERE em."itemCode" = s.code AND em."quantity" > 0)
    ORDER BY s.ca DESC
    LIMIT 20
  `, DAY, NEXT);

  // Agrégats par motif
  const buckets = { kit: 0, noPdn: 0 };
  for (const r of uncov) (r.isKit || r.has_bom || r.has_recipe ? (buckets.kit += r.ca) : (buckets.noPdn += r.ca));
  console.log(`\n— TOP articles NON costés (aucune réception sous ce code) —`);
  console.log("  Code        Article                          CA        Kit/BoM  Unités v/a/s");
  for (const r of uncov) {
    const flag = r.isKit || r.has_bom || r.has_recipe ? "KIT" : "—";
    const units = `${r.salesUnit ?? "?"}/${r.purchaseUnit ?? "?"}/${r.inventoryUnit ?? "?"}`;
    console.log(`  ${String(r.code).padEnd(11)} ${String(r.itemName ?? "").slice(0, 30).padEnd(30)} ${eur(r.ca).padStart(9)}  ${flag.padEnd(7)} ${units}`);
  }

  // ── 4. Parmi les COSTÉS : unité de vente ≠ unité d'achat (marge suspecte) ──
  const unitMismatch = await prisma.$queryRawUnsafe(`
    WITH sold AS (
      SELECT DISTINCT l."itemCode" AS code
      FROM ${COGS_FROM}
      WHERE i."cancelled" = false AND l."isService" = false AND l."itemCode" IS NOT NULL
        AND cogs."unitCost" IS NOT NULL
        AND i."docDate" >= $1::date AND i."docDate" < $2::date
    )
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE lower(coalesce(p."salesUnit",'')) <> lower(coalesce(p."purchaseUnit",''))
                              AND p."salesUnit" IS NOT NULL AND p."purchaseUnit" IS NOT NULL)::int AS mismatch
    FROM sold s LEFT JOIN "Product" p ON p."itemCode" = s.code
  `, DAY, NEXT);
  const um = unitMismatch[0];
  console.log(`\n— Articles costés : unité vente ≠ unité achat —`);
  console.log(`  ${um.mismatch}/${um.n} articles costés ont salesUnit ≠ purchaseUnit`
    + ` → marge de ces lignes potentiellement faussée (qté vendue × coût/unité d'achat sans conversion).`);

  // ── 5. Verdict ──
  console.log(`\n=== VERDICT ===`);
  const uncovCa = caAll - caCosted;
  console.log(`CA produit NON costé : ${eur(uncovCa)} (${pct(caAll > 0 ? 100 * uncovCa / caAll : null)} du CA).`);
  console.log(`  dont (top 20) kit/BoM : ${eur(buckets.kit)} · sans EM (mismatch code / jamais reçu) : ${eur(buckets.noPdn)}`);
  console.log(`Si "kit/BoM" domine  → coûter les articles reconditionnés via leur recette (composants × coût EM).`);
  console.log(`Si "sans EM" domine  → vérifier le rapprochement des codes vente↔achat (variantes, préfixes) et la synchro PDN.`);
  console.log(`Si "unité v≠a" élevé  → convertir la qté vendue vers l'unité d'achat avant × coût EM.\n`);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
