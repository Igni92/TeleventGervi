/**
 * Migre les clients dont le code finit par "." en delivery modes du parent.
 * Utilise du SQL brut pour contourner le lock Prisma (dev server Windows).
 *
 *   node scripts/cleanup-dot-clients.mjs [--dry-run] [--mode-name=SCACHAP]
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function cuid() {
  // Simple cuid-like ID — Prisma's @default(cuid()) attendrait quand on insère via Prisma,
  // mais on passe par SQL brut donc on génère un ID compatible cuid (préfixe c).
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const modeNameArg = args.find((a) => a.startsWith("--mode-name="));
  const ALT_MODE_NAME = modeNameArg ? modeNameArg.split("=")[1] : "SCACHAP";

  console.log(`🔍 ${dryRun ? "[DRY RUN] " : ""}Cleanup clients dot-suffixed → modes "${ALT_MODE_NAME}"\n`);

  const all = await prisma.client.findMany({
    select: { id: true, code: true, nom: true },
    orderBy: { code: "asc" },
  });
  const codeMap = new Map(all.map((c) => [c.code, c]));
  const dotClients = all.filter((c) => c.code.endsWith("."));

  console.log(`Trouvé ${dotClients.length} clients avec code finissant par "." sur ${all.length} total\n`);

  let merged = 0, renamed = 0, errors = 0;
  for (const dot of dotClients) {
    const parentCode = dot.code.slice(0, -1);
    const parent = codeMap.get(parentCode);

    if (!parent) {
      console.log(`  ✏️  ${dot.code} (${dot.nom}) → renommé en "${parentCode}"`);
      if (!dryRun) {
        try {
          await prisma.client.update({ where: { id: dot.id }, data: { code: parentCode } });
          renamed++;
        } catch (e) {
          console.log(`     ⚠️  ${e.message}`);
          errors++;
        }
      } else renamed++;
      continue;
    }

    console.log(`  ↳ ${parent.code} (${parent.nom}) ← merge ${dot.code} comme "${ALT_MODE_NAME}"`);
    if (dryRun) { merged++; continue; }

    try {
      // SQL brut pour ClientDeliveryMode (Prisma client pas régénéré)
      // 1. Mode "Direct" pour le parent (idempotent — INSERT ... WHERE NOT EXISTS)
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ClientDeliveryMode" ("id", "clientId", "name", "sapCardCode", "isDefault", "createdAt", "updatedAt")
        SELECT $1, $2, 'Direct', $3, true, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM "ClientDeliveryMode" WHERE "clientId" = $2 AND "sapCardCode" = $3
        )
      `, cuid(), parent.id, parent.code);

      // 2. Mode alt (SCACHAP) pour le dot-code
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ClientDeliveryMode" ("id", "clientId", "name", "sapCardCode", "isDefault", "createdAt", "updatedAt")
        SELECT $1, $2, $3, $4, false, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM "ClientDeliveryMode" WHERE "clientId" = $2 AND "sapCardCode" = $4
        )
      `, cuid(), parent.id, ALT_MODE_NAME, dot.code);

      // 3. Supprime le client point (cascade sur appels/rappels)
      await prisma.client.delete({ where: { id: dot.id } });
      merged++;
    } catch (e) {
      console.log(`     ⚠️  ${e.message}`);
      errors++;
    }
  }

  console.log(`\n${dryRun ? "📋 [dry-run]" : "✅"} Résultat :`);
  console.log(`  ${merged} mergés en delivery modes`);
  console.log(`  ${renamed} renommés (point retiré)`);
  console.log(`  ${errors} erreurs`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
