/**
 * Réconciliation du REGISTRE des lots ↔ stock physique.
 *
 * Règle métier : « pas de stock → pas de lot ». Le registre `ProductBatch.quantity`
 * peut garder un reliquat historique (dérive) sur un article qui, PHYSIQUEMENT,
 * n'a plus de stock (somme `ProductStock.inStock` = 0). Ce script remet à 0 ces
 * reliquats fantômes — les vrais mouvements (réception, vente, fabrication,
 * inventaire, retour) maintiennent désormais le registre, ce script ne sert qu'à
 * PURGER la dérive accumulée AVANT la mise en place du suivi complet.
 *
 * ⚠️ DRY-RUN par défaut : n'écrit RIEN. Passer `--apply` pour appliquer.
 *
 *   node scripts/reconcile-lot-ledger.mjs           # aperçu (dry-run)
 *   node scripts/reconcile-lot-ledger.mjs --apply   # applique (quantity → 0)
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

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

async function main() {
  // Lots au registre avec un reliquat > 0 alors que l'article n'a AUCUN stock
  // physique (somme ProductStock.inStock = 0, tous entrepôts). = lots fantômes.
  const phantoms = await prisma.$queryRawUnsafe(
    `SELECT b."id", p."itemCode", b."batchNumber", b."quantity"
       FROM "ProductBatch" b
       JOIN "Product" p ON p."id" = b."productId"
      WHERE b."quantity" > 0
        AND COALESCE(
              (SELECT SUM(s."inStock") FROM "ProductStock" s WHERE s."productId" = p."id"),
              0
            ) <= 0
      ORDER BY p."itemCode", b."batchNumber";`,
  );

  if (phantoms.length === 0) {
    console.log("✅ Registre propre : aucun lot fantôme (stock physique nul mais registre > 0).");
    return;
  }

  console.log(`${APPLY ? "🧹 APPLY" : "🔎 DRY-RUN"} — ${phantoms.length} lot(s) fantôme(s) (stock physique nul, registre > 0) :\n`);
  for (const r of phantoms) {
    console.log(`  ${String(r.itemCode).padEnd(14)} ${String(r.batchNumber).padEnd(12)} reliquat ${Number(r.quantity)}`);
  }

  if (!APPLY) {
    console.log(`\nAperçu uniquement. Relance avec --apply pour remettre ces ${phantoms.length} lot(s) à 0.`);
    return;
  }

  const ids = phantoms.map((r) => r.id);
  const CHUNK = 500;
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const res = await prisma.productBatch.updateMany({ where: { id: { in: slice } }, data: { quantity: 0 } });
    updated += res.count;
  }
  console.log(`\n✅ ${updated} lot(s) remis à 0 (quantity = 0).`);
}

main()
  .catch((e) => { console.error("❌ Réconciliation échouée:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
