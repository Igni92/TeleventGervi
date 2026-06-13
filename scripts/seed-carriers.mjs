/**
 * Seed C11 — transporteurs TeleVent.
 *
 *   Usage: node scripts/seed-carriers.mjs [--dry-run]
 *
 * Peuple la table Carrier avec les transporteurs réellement utilisés dans SAP.
 * Le champ SAP cible est ORDR.U_TrspCode ; `sapValue` = le code texte SAP
 * (relevé dans l'historique des factures via sap_scrape/scan_trsp.js).
 *
 * Idempotent : upsert sur "name" (ON CONFLICT). Relançable sans danger.
 * Raw SQL pour ne pas dépendre d'un `prisma generate` à jour.
 */

import { PrismaClient } from "@prisma/client";

// name (libellé app) → { sapValue (U_TrspCode SAP), position }
const CARRIERS = [
  { name: "Antoine", sapValue: "ANTOINE", position: 1 },
  { name: "Rungis enlèvement", sapValue: "RUNGIS", position: 2 },
  { name: "Delanchy", sapValue: "DELANCHY", position: 3 },
  { name: "Fargier", sapValue: "FARGIER", position: 4 },
];

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const prisma = new PrismaClient();

  console.log(`🚚 Seed ${CARRIERS.length} transporteurs (kind=field, sapField=U_TrspCode)${dryRun ? " [dry-run]" : ""}\n`);

  for (const c of CARRIERS) {
    if (dryRun) {
      console.log(`  • ${c.name.padEnd(20)} → U_TrspCode=${c.sapValue} (pos ${c.position})`);
      continue;
    }
    const id = `c_${Math.random().toString(36).slice(2, 12)}`;
    await prisma.$executeRaw`
      INSERT INTO "Carrier" ("id", "name", "kind", "sapField", "sapValue", "active", "position", "createdAt", "updatedAt")
      VALUES (${id}, ${c.name}, 'field', 'U_TrspCode', ${c.sapValue}, true, ${c.position}, NOW(), NOW())
      ON CONFLICT ("name") DO UPDATE
        SET "kind" = 'field',
            "sapField" = 'U_TrspCode',
            "sapValue" = EXCLUDED."sapValue",
            "active" = true,
            "position" = EXCLUDED."position",
            "updatedAt" = NOW();
    `;
    console.log(`  ✓ ${c.name.padEnd(20)} → U_TrspCode=${c.sapValue}`);
  }

  if (!dryRun) {
    const rows = await prisma.$queryRaw`
      SELECT "name", "sapValue", "position" FROM "Carrier" WHERE "active" = true ORDER BY "position" ASC;
    `;
    console.log(`\n✅ ${rows.length} transporteurs actifs en base.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
