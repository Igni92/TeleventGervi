import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Trouver un client avec sapGroupCode et le plus de pairs dans le même groupe,
  // qui ait des factures sur l'année N-1 — bon candidat pour B9.
  const yearMinus1 = new Date().getFullYear() - 1;
  const periodStart = new Date(Date.UTC(yearMinus1, 0, 1));
  const periodEnd = new Date(Date.UTC(yearMinus1, 11, 31, 23, 59, 59));

  const candidates = await prisma.client.findMany({
    where: { sapGroupCode: { not: null } },
    select: { id: true, code: true, nom: true, sapGroupCode: true, sapGroupName: true },
    take: 200,
  });

  const enriched = [];
  for (const c of candidates) {
    const peers = await prisma.sapBusinessPartner.count({
      where: { groupCode: c.sapGroupCode, cardType: "C", cardCode: { not: c.code } },
    });
    const invoices = await prisma.sapInvoice.count({
      where: { cardCode: c.code, docDate: { gte: periodStart, lte: periodEnd }, cancelled: false },
    });
    enriched.push({ ...c, peers, invoices });
  }

  const scored = enriched
    .filter((c) => c.peers >= 2 && c.invoices >= 3)
    .sort((a, b) => (b.peers * b.invoices) - (a.peers * a.invoices))
    .slice(0, 5);

  if (scored.length === 0) {
    console.log("Aucun client trouvé avec sapGroupCode + pairs + factures N-1. Premiers candidats bruts :");
    console.table(enriched.slice(0, 5));
    return;
  }
  console.log(`Top 5 candidats pour tester B9 (N-1 = ${yearMinus1}) :`);
  console.table(scored.map((c) => ({
    nom: c.nom, code: c.code, groupe: c.sapGroupName ?? `#${c.sapGroupCode}`,
    pairs: c.peers, factures_N1: c.invoices,
    url: `http://localhost:3000/clients/${c.id}`,
  })));
}

main().finally(() => prisma.$disconnect());
