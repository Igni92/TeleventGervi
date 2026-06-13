import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * B7 — Migration : Client.email → Contact.email.
 *
 * Pour chaque client qui a un Client.email non vide et qui n'a pas déjà
 * un Contact portant cet email, crée un Contact "Email standard" avec
 * l'email du client.
 *
 * Idempotent : ré-exécutable sans risque (recherche par email exact).
 *
 * NE TOUCHE PAS au Client.email — laissé en place tant que le retrait
 * complet du schéma n'est pas fait (cf. memory backlog-features-batch2).
 *
 * Usage : node scripts/migrate-client-email-to-contact.mjs
 */

async function main() {
  const clients = await prisma.client.findMany({
    where: { email: { not: null } },
    select: { id: true, code: true, nom: true, email: true },
  });

  console.log(`Clients avec Client.email non vide : ${clients.length}`);

  let created = 0;
  let skippedAlreadyOnContact = 0;
  let skippedEmptyEmail = 0;

  for (const c of clients) {
    const email = (c.email ?? "").trim();
    if (!email) { skippedEmptyEmail++; continue; }

    const existing = await prisma.contact.findFirst({
      where: { clientId: c.id, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) { skippedAlreadyOnContact++; continue; }

    // Trouver le prochain ordre disponible
    const last = await prisma.contact.findFirst({
      where: { clientId: c.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPos = (last?.position ?? -1) + 1;

    await prisma.contact.create({
      data: {
        clientId: c.id,
        name: "Standard",
        role: null,
        email,
        position: nextPos,
        note: "Migré depuis Client.email (B7)",
      },
    });
    created++;
  }

  console.log(`✅ ${created} Contact(s) créé(s)`);
  console.log(`↩  ${skippedAlreadyOnContact} client(s) avaient déjà un Contact avec cet email`);
  console.log(`⊘  ${skippedEmptyEmail} email(s) vide(s) ignoré(s)`);
}

main().finally(() => prisma.$disconnect());
