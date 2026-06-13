import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Migration des Client.notes legacy vers les champs compta dédiés.
 *
 * Pour chaque client avec `notes` non vide, parse ligne par ligne :
 *   - `Adresse: …`   → adresseFacturation (si pas déjà rempli)
 *   - `Email: <addr>` →
 *       - si addr contient "compta"   → emailCompta (si pas déjà rempli)
 *       - si addr contient "reception"→ emailReception (si pas déjà rempli)
 *       - sinon → ignoré (email commercial, vit déjà sur Contact)
 *
 * Après extraction : **Client.notes vidé** (set null). C'est destructif, on
 * imprime un récap par client avant de commit.
 *
 * Idempotent : si emailCompta/emailReception/adresseFacturation déjà
 * renseignés, on ne les écrase pas.
 *
 * Modes :
 *   - DRY RUN par défaut (juste un récap, aucune écriture)
 *   - `--apply` pour exécuter les UPDATE et vider les notes.
 */

const APPLY = process.argv.includes("--apply");

function parseNotes(notes) {
  const out = {};
  const usedLines = new Set();
  const lines = notes.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*(adresse|email)\s*[:=]\s*(.+?)\s*$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!val) continue;

    if (key === "adresse") {
      out.adresse = val;
      usedLines.add(i);
    } else if (key === "email") {
      const lower = val.toLowerCase();
      if (lower.includes("compta")) {
        out.emailCompta = val;
        usedLines.add(i);
      } else if (lower.includes("reception") || lower.includes("réception")) {
        out.emailReception = val;
        usedLines.add(i);
      }
      // email "standard" non rattaché (commercial) → on laisse, vit sur Contact (B7)
    }
  }
  return { extracted: out, usedLines, totalLines: lines.length };
}

async function main() {
  const clients = await prisma.client.findMany({
    where: { notes: { not: null } },
    select: {
      id: true, code: true, nom: true, notes: true,
    },
  });

  // Pull also current compta fields via raw SQL (Prisma client peut-être pas regen).
  const ids = clients.map((c) => c.id);
  const currentRows = ids.length === 0 ? [] : await prisma.$queryRawUnsafe(
    `SELECT "id", "emailCompta", "emailReception", "adresseFacturation"
     FROM "Client" WHERE "id" = ANY($1::text[])`,
    ids,
  );
  const currentById = new Map(currentRows.map((r) => [r.id, r]));

  console.log(`Mode : ${APPLY ? "APPLY (écriture)" : "DRY RUN (lecture seule)"}`);
  console.log(`Clients avec notes : ${clients.length}\n`);

  let touched = 0;
  let setCompta = 0, setReception = 0, setAdresse = 0;

  for (const c of clients) {
    const { extracted, usedLines, totalLines } = parseNotes(c.notes ?? "");
    const curr = currentById.get(c.id) ?? {};
    const updates = {};

    if (extracted.emailCompta && !curr.emailCompta) {
      updates.emailCompta = extracted.emailCompta;
      setCompta++;
    }
    if (extracted.emailReception && !curr.emailReception) {
      updates.emailReception = extracted.emailReception;
      setReception++;
    }
    if (extracted.adresse && !curr.adresseFacturation) {
      updates.adresseFacturation = extracted.adresse;
      setAdresse++;
    }

    const willClearNotes = usedLines.size > 0;
    if (Object.keys(updates).length === 0 && !willClearNotes) continue;

    touched++;
    const consumedOnly = usedLines.size === totalLines;
    const verb = APPLY ? "→" : "(dry)";
    console.log(`${verb} ${c.code} · ${c.nom}`);
    if (updates.emailCompta) console.log(`   compta     = ${updates.emailCompta}`);
    if (updates.emailReception) console.log(`   reception  = ${updates.emailReception}`);
    if (updates.adresseFacturation) console.log(`   adresse    = ${updates.adresseFacturation}`);
    if (willClearNotes) {
      console.log(`   notes      → ${consumedOnly ? "vidées" : `${usedLines.size}/${totalLines} lignes consommées, reste vidé`}`);
    }

    if (APPLY) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Client"
         SET "emailCompta"        = COALESCE($1, "emailCompta"),
             "emailReception"     = COALESCE($2, "emailReception"),
             "adresseFacturation" = COALESCE($3, "adresseFacturation"),
             "notes"              = NULL,
             "updatedAt"          = NOW()
         WHERE "id" = $4`,
        updates.emailCompta ?? null,
        updates.emailReception ?? null,
        updates.adresseFacturation ?? null,
        c.id,
      );
    }
  }

  console.log(`\n${APPLY ? "✅" : "🔍"} Récap : ${touched} client(s) ${APPLY ? "modifiés" : "à modifier"}`);
  console.log(`   emailCompta     : ${setCompta}`);
  console.log(`   emailReception  : ${setReception}`);
  console.log(`   adresseFacturation : ${setAdresse}`);
  if (!APPLY) {
    console.log(`\nRelance avec --apply pour exécuter.`);
  }
}

main().finally(() => prisma.$disconnect());
