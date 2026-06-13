/**
 * Migration douce : extrait email et groupe (Niveau/Groupe/Catégorie) du champ
 * `notes` legacy vers les nouveaux champs `email` / `sapGroupName`, et nettoie
 * les lignes extraites du textarea.
 *
 * Le `sapGroupCode` (Int) n'est PAS rempli ici — il faudra le resync depuis
 * SAP via /api/sap/sync ou équivalent (le libellé seul suffit à l'affichage).
 *
 * Usage : node scripts/migrate-client-notes-split.mjs [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const DRY = process.argv.includes("--dry-run");
const prisma = new PrismaClient();

// Match "Email: foo@bar.fr" (case-insensitive, début de ligne)
const EMAIL_LINE = /^\s*(?:E-?mail|Mail)\s*[:\-]\s*(\S+@\S+\.\S+)\s*$/gim;
// Match "Niveau: …" / "Groupe: …" / "Catégorie: …"
const GROUPE_LINE = /^\s*(?:Niveau|Groupe|Cat[ée]gorie)\s*[:\-]\s*(.+?)\s*$/gim;
// Match "Adresse: …" (à supprimer)
const ADRESSE_LINE = /^\s*Adresse\s*[:\-]\s*.+?\s*$/gim;

async function main() {
  const clients = await prisma.client.findMany({
    where: { notes: { not: null } },
    select: { id: true, code: true, nom: true, notes: true, email: true, sapGroupName: true },
  });

  let touched = 0;
  let withEmail = 0;
  let withGroupe = 0;

  for (const c of clients) {
    const notes = c.notes ?? "";

    // Extract email (premier match)
    let emailFound = null;
    EMAIL_LINE.lastIndex = 0;
    const eMatch = EMAIL_LINE.exec(notes);
    if (eMatch) emailFound = eMatch[1].trim().toLowerCase();

    // Extract groupe (premier match)
    let groupeFound = null;
    GROUPE_LINE.lastIndex = 0;
    const gMatch = GROUPE_LINE.exec(notes);
    if (gMatch) groupeFound = gMatch[1].trim();

    // Cleanup : retire Email/Niveau/Adresse de notes
    let cleaned = notes
      .replace(EMAIL_LINE, "")
      .replace(GROUPE_LINE, "")
      .replace(ADRESSE_LINE, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const nextEmail = c.email ?? emailFound ?? null;
    const nextGroupe = c.sapGroupName ?? groupeFound ?? null;
    const nextNotes = cleaned || null;

    const changed =
      nextEmail !== c.email ||
      nextGroupe !== c.sapGroupName ||
      nextNotes !== c.notes;

    if (!changed) continue;
    touched++;
    if (emailFound) withEmail++;
    if (groupeFound) withGroupe++;

    if (DRY) {
      console.log(
        `[DRY] ${c.code} ${c.nom}`,
        emailFound ? `email=${emailFound}` : "",
        groupeFound ? `groupe="${groupeFound}"` : "",
      );
      continue;
    }

    await prisma.client.update({
      where: { id: c.id },
      data: { email: nextEmail, sapGroupName: nextGroupe, notes: nextNotes },
    });
  }

  console.log(
    `${DRY ? "[DRY] " : ""}Touched ${touched}/${clients.length} clients ` +
      `(email extrait: ${withEmail}, groupe extrait: ${withGroupe})`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
