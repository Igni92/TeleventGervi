/**
 * DDL idempotent — Fabrication v2 (refonte recettes + runs tracés).
 *
 * Ce script :
 *   1. Ajoute `parentQty` à "ProductionRecipe" (nb de colis parent produits
 *      par « tour » de recette — ex. 2 DECO16 = 1 myrtille + 1 groseille + 2 mûre).
 *   2. Crée "FabricationRun" / "FabricationRunLine" (traçabilité locale des
 *      ordres de production : article choisi PAR FAMILLE + LOT affecté).
 *   3. Migration douce : convertit les ProductBom historiques (par article)
 *      en ProductionRecipe par famille (familyOf) pour les parents qui n'ont
 *      pas encore de recette. Ne touche jamais une recette existante.
 *
 * ⚠️ Ces tables sont accédées en $queryRawUnsafe/$executeRawUnsafe uniquement
 *    (le client Prisma généré ne les connaît pas encore).
 *
 *   Usage : node scripts/ddl-fabrication-v2.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle backfill-docs.mjs ──
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

/** Copie JS de lib/familles.familyOf (le .mjs ne peut pas importer le TS). */
function familyOf(itemName, groupName) {
  const n = (itemName ?? "").toUpperCase();
  if (n.includes("MYRTILLE")) return { key: "myrtille", label: "Myrtille" };
  if (n.includes("GROSEILLE")) return { key: "groseille", label: "Groseille" };
  if (n.includes("FRAMBOISE")) return { key: "framboise", label: "Framboise" };
  if (n.includes("CASSIS")) return { key: "cassis", label: "Cassis" };
  if (n.includes("MURE") || n.includes("MÛRE")) return { key: "mure", label: "Mûre" };
  if (n.includes("FRAISE")) return { key: "fraise", label: "Fraise" };
  const g = groupName?.trim();
  return { key: `g_${g ?? "na"}`, label: g || "Sans groupe" };
}

async function main() {
  console.log("══ DDL Fabrication v2 ══\n");

  // ── 1. parentQty sur ProductionRecipe ──────────────────────────────
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductionRecipe"
      ADD COLUMN IF NOT EXISTS "parentQty" DOUBLE PRECISION NOT NULL DEFAULT 1;
  `);
  console.log('✅ ProductionRecipe."parentQty" (DEFAULT 1)');

  // ── 2. FabricationRun ──────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FabricationRun" (
      "id"             TEXT PRIMARY KEY,
      "opCode"         TEXT,
      "parentItemCode" TEXT NOT NULL,
      "parentItemName" TEXT,
      "parentColis"    DOUBLE PRECISION NOT NULL,
      "warehouseCode"  TEXT NOT NULL DEFAULT '01',
      "recipeSnapshot" JSONB NOT NULL,
      "totalCost"      DOUBLE PRECISION,
      "parentValue"    DOUBLE PRECISION,
      "status"         TEXT NOT NULL DEFAULT 'pending',
      "error"          TEXT,
      "sapExitEntry"   INTEGER,
      "sapExitDocNum"  INTEGER,
      "sapEntryEntry"  INTEGER,
      "sapEntryDocNum" INTEGER,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdBy"      TEXT
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "FabricationRun_createdAt_idx" ON "FabricationRun" ("createdAt" DESC);
  `);
  console.log("✅ FabricationRun (+ index createdAt)");

  // ── 3. FabricationRunLine ──────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FabricationRunLine" (
      "id"            TEXT PRIMARY KEY,
      "runId"         TEXT NOT NULL REFERENCES "FabricationRun"("id") ON DELETE CASCADE,
      "family"        TEXT NOT NULL,
      "familyLabel"   TEXT,
      "itemCode"      TEXT NOT NULL,
      "itemName"      TEXT,
      "batchNumber"   TEXT NOT NULL,
      "colisQty"      DOUBLE PRECISION NOT NULL,
      "pieceQty"      DOUBLE PRECISION NOT NULL DEFAULT 0,
      "purchasePrice" DOUBLE PRECISION,
      "warehouseCode" TEXT
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "FabricationRunLine_runId_idx" ON "FabricationRunLine" ("runId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "FabricationRunLine_batchNumber_idx" ON "FabricationRunLine" ("batchNumber");
  `);
  console.log("✅ FabricationRunLine (+ index runId, batchNumber)");

  // ── 4. Migration douce ProductBom → ProductionRecipe (familles) ────
  // Uniquement pour les parents SANS recette famille existante.
  const boms = await prisma.$queryRawUnsafe(`
    SELECT b."parentItemCode", b."componentItemCode", b."qtyPerParent",
           pp."salesQtyPerPackUnit" AS "parentPack", pp."salesUnit" AS "parentUnit",
           pc."salesQtyPerPackUnit" AS "compPack",   pc."salesUnit" AS "compUnit",
           pc."itemName" AS "compName", pc."groupName" AS "compGroup"
      FROM "ProductBom" b
      JOIN "Product" pp ON pp."itemCode" = b."parentItemCode"
      JOIN "Product" pc ON pc."itemCode" = b."componentItemCode"
     WHERE NOT EXISTS (SELECT 1 FROM "ProductionRecipe" r WHERE r."parentItemCode" = b."parentItemCode");
  `);
  if (boms.length === 0) {
    console.log("ℹ️  Migration BoM→recette : rien à faire (recettes déjà présentes ou BoM vide).");
  } else {
    const ratio = (pack, unit) => (/kg|kilo/i.test(unit ?? "") ? 1 : (pack && pack > 1 ? pack : 1));
    // Regroupe par parent puis par famille (Σ des colis convertis).
    const byParent = new Map();
    for (const b of boms) {
      const fam = familyOf(b.compName, b.compGroup);
      // qtyPerParent est en pie composant / pie parent → conversion colis/colis :
      const qtyColis = b.qtyPerParent * ratio(b.parentPack, b.parentUnit) / ratio(b.compPack, b.compUnit);
      const m = byParent.get(b.parentItemCode) ?? new Map();
      const cur = m.get(fam.key) ?? { label: fam.label, qty: 0 };
      cur.qty += qtyColis;
      m.set(fam.key, cur);
      byParent.set(b.parentItemCode, m);
    }
    for (const [parent, fams] of byParent) {
      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO "ProductionRecipe" ("id", "parentItemCode", "parentQty", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, $1, 1, NOW(), NOW())
        ON CONFLICT ("parentItemCode") DO NOTHING
        RETURNING "id";
      `, parent);
      if (rows.length === 0) continue; // recette apparue entre-temps
      const recipeId = rows[0].id;
      let pos = 0;
      for (const [key, { label, qty }] of fams) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "ProductionRecipeComponent" ("id", "recipeId", "familyKey", "familyLabel", "qtyColis", "position")
          VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
          ON CONFLICT ("recipeId", "familyKey") DO NOTHING;
        `, recipeId, key, label, Math.round(qty * 1000) / 1000, pos++);
      }
      console.log(`✅ Migration BoM→recette : ${parent} (${fams.size} famille(s), parentQty=1)`);
    }
  }

  // ── 5. État final ──────────────────────────────────────────────────
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "ProductionRecipe")::int          AS recettes,
           (SELECT COUNT(*) FROM "ProductionRecipeComponent")::int AS composants,
           (SELECT COUNT(*) FROM "FabricationRun")::int            AS runs,
           (SELECT COUNT(*) FROM "FabricationRunLine")::int        AS run_lines;
  `);
  console.log("\n📊 État :", state);
  const recs = await prisma.$queryRawUnsafe(`
    SELECT r."parentItemCode", r."parentQty",
           STRING_AGG(c."familyLabel" || ' × ' || c."qtyColis", ' + ' ORDER BY c."position") AS compo
      FROM "ProductionRecipe" r
      LEFT JOIN "ProductionRecipeComponent" c ON c."recipeId" = r."id"
     GROUP BY r."parentItemCode", r."parentQty" ORDER BY r."parentItemCode";
  `);
  for (const r of recs) console.log(`   • ${r.parentItemCode} (tour de ${r.parentQty} colis) = ${r.compo ?? "—"}`);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
