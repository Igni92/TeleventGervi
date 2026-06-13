import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cols = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Client'
    ORDER BY ordinal_position;
  `;
  console.log("Colonnes de Client :");
  console.table(cols);
}

main().finally(() => prisma.$disconnect());
