/**
 * G1 — Affecte le vendeur MM à tous les clients GMS ayant passé une commande
 * SAP (SapOrder) il y a moins de 30 jours.
 *
 *   Usage: node scripts/assign-mm-gms-30j.mjs [--dry-run]
 *
 * GMS = Client.type = 'GMS' (dérivé du groupe SAP « GMS… » à l'import).
 * Ne touche pas aux clients déjà affectés à MM (idempotent) ; liste ceux qui
 * avaient un AUTRE vendeur avant de les écraser.
 */
import { PrismaClient } from "@prisma/client";

const dryRun = process.argv.includes("--dry-run");
const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.$queryRawUnsafe(`
    SELECT c."id", c."code", c."nom", c."vendeur", lo."last_order"::text
    FROM "Client" c
    JOIN (
      SELECT "cardCode", MAX("docDate") AS last_order
      FROM "SapOrder" WHERE "cancelled" = false
        AND "docDate" >= NOW() - INTERVAL '30 days'
      GROUP BY 1
    ) lo ON lo."cardCode" = c."code"
    WHERE c."type" = 'GMS'
    ORDER BY c."nom"`);

  const toChange = candidates.filter((c) => c.vendeur !== "MM");
  const overwritten = toChange.filter((c) => c.vendeur != null);

  console.log(`GMS avec commande < 30j : ${candidates.length}`);
  console.log(`  déjà MM       : ${candidates.length - toChange.length}`);
  console.log(`  à affecter MM : ${toChange.length}` + (dryRun ? "  [dry-run, rien modifié]" : ""));
  if (overwritten.length) {
    console.log(`  ⚠️ avaient un autre vendeur (écrasés) :`);
    for (const c of overwritten) console.log(`     ${c.code} ${c.nom} (était: ${c.vendeur})`);
  }
  for (const c of toChange.slice(0, 15)) console.log(`   → ${c.code}  ${c.nom}  (dern. cde ${c.last_order?.slice(0, 10)})`);
  if (toChange.length > 15) console.log(`   … +${toChange.length - 15} autres`);

  if (!dryRun && toChange.length) {
    const ids = toChange.map((c) => c.id);
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "Client" SET "vendeur" = 'MM', "updatedAt" = NOW() WHERE "id" = ANY($1::text[])`, ids);
    console.log(`\n✅ ${n} clients affectés à MM`);
  }
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
