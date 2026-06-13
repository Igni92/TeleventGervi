/**
 * Diagnostic lecture seule — où est la commande d'AMARNE ?
 *   Usage: node scripts/diag-amarne.mjs [terme]   (défaut: AMARNE)
 *
 * Cherche le client, son BP miroir, et ses docs (Order / Invoice) pour
 * comprendre pourquoi le plan d'appel affiche 0 commande. N'écrit rien.
 */
import { PrismaClient } from "@prisma/client";

const term = (process.argv[2] || "AMARNE").toUpperCase();
const like = `%${term}%`;
const prisma = new PrismaClient();

const show = (label, rows) => {
  console.log(`\n=== ${label} (${rows.length}) ===`);
  for (const r of rows) console.log(r);
};

async function main() {
  show("Client local", await prisma.$queryRawUnsafe(
    `SELECT id, code, nom, vendeur, commercial, "activeTelevente",
            "sapGroupCode", "sapGroupName"
     FROM "Client" WHERE nom ILIKE $1 OR code ILIKE $1 ORDER BY nom`, like));

  show("SapBusinessPartner (miroir)", await prisma.$queryRawUnsafe(
    `SELECT "cardCode","cardName","cardType","groupCode","groupName","slpName","active"
     FROM "SapBusinessPartner" WHERE "cardName" ILIKE $1 OR "cardCode" ILIKE $1`, like));

  show("SapOrder par NOM (BL/commandes)", await prisma.$queryRawUnsafe(
    `SELECT "docEntry","docNum", "docDate"::text, "cardCode","cardName",
            "cancelled", "updateDate"::text
     FROM "SapOrder" WHERE "cardName" ILIKE $1
     ORDER BY "docDate" DESC LIMIT 10`, like));

  show("SapInvoice par NOM (factures)", await prisma.$queryRawUnsafe(
    `SELECT "docEntry","docNum","docDate"::text,"cardCode","cardName","updateDate"::text
     FROM "SapInvoice" WHERE "cardName" ILIKE $1
     ORDER BY "docDate" DESC LIMIT 5`, like));

  show("SapOrder LES PLUS RÉCENTS (tous clients)", await prisma.$queryRawUnsafe(
    `SELECT "docEntry","docNum","docDate"::text,"cardCode","cardName","updateDate"::text
     FROM "SapOrder" ORDER BY "docDate" DESC LIMIT 5`));

  show("Curseur de sync", await prisma.$queryRawUnsafe(
    `SELECT "lastBpUpdate"::text, "lastOrderUpdate"::text,
            "lastInvoiceUpdate"::text, "lastPdnUpdate"::text, "lastTickAt"::text
     FROM "SapMirrorCursor" WHERE id = 1`));

  show("Comptes globaux miroir", await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM "SapOrder")::int AS orders,
            (SELECT COUNT(*) FROM "SapInvoice")::int AS invoices,
            (SELECT COUNT(*) FROM "SapBusinessPartner")::int AS bps,
            (SELECT MAX("docDate")::text FROM "SapOrder") AS last_order_date`));
}

main()
  .catch((e) => { console.error("ERREUR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
