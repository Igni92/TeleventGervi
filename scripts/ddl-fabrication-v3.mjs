/**
 * DDL idempotent — Fabrication v3 (recettes en UNITÉS + multi-magasins).
 *
 * Ce script ajoute `qtyUnits` à "ProductionRecipeComponent" :
 *   • qtyUnits NON NULL → la ligne de recette est exprimée en UNITÉS DE BASE
 *     (barquettes pour les fruits, kg pour les articles au poids).
 *     Ex. 6 barquettes groseille + 5 mûre + 5 myrtille = 1 DECO16.
 *   • qtyUnits NULL → ligne historique en COLIS (qtyColis fait foi, comme en v2).
 *   Aucune conversion automatique : les recettes existantes restent en colis
 *   et continuent de fonctionner ; elles passent en unités à leur prochaine
 *   édition dans /fabrication.
 *
 * Le multi-magasins (sortie des composants depuis des magasins différents,
 * entrée du produit fini dans un autre) ne nécessite AUCUN DDL :
 * FabricationRunLine.warehouseCode (source par ligne) et
 * FabricationRun.warehouseCode (magasin d'entrée) existent déjà.
 *
 * ⚠️ Colonne accédée en $queryRawUnsafe/$executeRawUnsafe uniquement
 *    (client Prisma non régénéré).
 *
 *   Usage : node scripts/ddl-fabrication-v3.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle ddl-fabrication-v2 ──
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
const dbUrl = (() => {
  const u = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL introuvable (.env/.env.local)");
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  console.log("══ DDL Fabrication v3 ══\n");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductionRecipeComponent"
      ADD COLUMN IF NOT EXISTS "qtyUnits" DOUBLE PRECISION;
  `);
  console.log('✅ ProductionRecipeComponent."qtyUnits" (NULL = ligne legacy en colis)');

  const recs = await prisma.$queryRawUnsafe(`
    SELECT r."parentItemCode", r."parentQty",
           STRING_AGG(
             c."familyLabel" || ' × ' ||
             COALESCE(c."qtyUnits"::text || ' unités', c."qtyColis"::text || ' colis'),
             ' + ' ORDER BY c."position") AS compo
      FROM "ProductionRecipe" r
      LEFT JOIN "ProductionRecipeComponent" c ON c."recipeId" = r."id"
     GROUP BY r."parentItemCode", r."parentQty" ORDER BY r."parentItemCode";
  `);
  console.log(`\n📊 ${recs.length} recette(s) :`);
  for (const r of recs) console.log(`   • ${r.parentItemCode} (tour de ${r.parentQty} colis) = ${r.compo ?? "—"}`);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
