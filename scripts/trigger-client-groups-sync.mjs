import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1) Diagnostique état actuel
  const bpTotal = await prisma.sapBusinessPartner.count({ where: { cardType: "C" } });
  const bpWithGroup = await prisma.sapBusinessPartner.count({
    where: { cardType: "C", groupCode: { not: null } },
  });
  const clientsTotal = await prisma.client.count();
  const clientsWithGroup = await prisma.client.count({
    where: { sapGroupCode: { not: null } },
  });
  console.log("AVANT :");
  console.log(`  SapBusinessPartner (C) : ${bpTotal} total · ${bpWithGroup} avec groupCode`);
  console.log(`  Client                 : ${clientsTotal} total · ${clientsWithGroup} avec sapGroupCode`);

  if (bpWithGroup === 0) {
    console.log("\n⚠️  Aucun SapBusinessPartner n'a de groupCode — le mirror SAP BP doit être lancé d'abord.");
    console.log("   POST /api/sap/sync/mirror ou /api/sap/sync/backfill côté logged-in.");
    return;
  }

  // 2) Trigger la propagation via raw SQL — équivalent direct de syncClientGroupsFromMirror.
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
  console.log(`\n✅ ${updated} client(s) mis à jour.`);

  const clientsWithGroupAfter = await prisma.client.count({
    where: { sapGroupCode: { not: null } },
  });
  console.log(`APRÈS : ${clientsWithGroupAfter}/${clientsTotal} clients avec sapGroupCode`);
}

main().finally(() => prisma.$disconnect());
