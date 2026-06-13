/**
 * One-shot import script: GMS Patisserie 1/2/3/4 from Orderlion export.
 *
 *   Usage: node scripts/import-gms-pat.mjs [--clear] [--dry-run]
 *
 *     --clear   : truncate Client + dependants (Rappel, AppelLog, TempAssignment) before insert
 *     --dry-run : preview without writing anything
 *
 * Maps Orderlion columns → TeleVent Client model:
 *   Code client            → code
 *   Nom du client          → nom
 *   "GMS"                  → type
 *   Téléphone (normalised) → tel1
 *   Jours de livraison     → joursAppel  (mon/tue/… → 1/2/…)
 *   Niveau + Email + Adr.  → notes (compacted, since dedicated fields don't exist yet)
 */

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const XLSX_PATH = "C:/Users/Televente/Downloads/Orderlion_liste_de_clients_260522.xlsx";

const GMS_PAT_GROUPS = {
  "GMS - Patisserie 1 Premium":    "Premium",
  "GMS - Patisserie 2 Valorisé":   "Valorisé",
  "GMS - Patisserie 3 Bien placé": "Bien placé",
  "GMS - Patisserie 4 Agressif":   "Agressif",
};

const DAY_MAP = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };

function cleanPhone(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (!s) return null;
  if (s.startsWith("+")) return s.replace(/\s+/g, " ");
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  }
  return s; // fallback raw
}

function convertDays(s) {
  if (!s) return "1,2,3,4,5,6";
  const out = s
    .split(",")
    .map((d) => DAY_MAP[d.trim().toLowerCase()])
    .filter((n) => n !== undefined);
  return out.length ? out.join(",") : "1,2,3,4,5,6";
}

function buildNotes(row, niveau) {
  const lines = [`Niveau: GMS Patisserie ${niveau}`];
  if (row["Email"]) lines.push(`Email: ${row["Email"]}`);
  const addr = [row["Rue"], row["Code Postal"], row["Ville"]]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(", ");
  if (addr) lines.push(`Adresse: ${addr}`);
  if (row["Notes internes"]) lines.push(`\n${row["Notes internes"]}`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const doClear = args.includes("--clear");
  const dryRun = args.includes("--dry-run");

  const prisma = new PrismaClient();

  console.log("📂 Lecture du fichier Excel…");
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Main"], { defval: "" });

  const filtered = rows.filter((r) => {
    if (String(r["Supprimé"]).trim() === "Supprimé") return false;
    return GMS_PAT_GROUPS[r["Groupe client"]];
  });

  console.log(`✓ ${filtered.length} clients sélectionnés (GMS Patisserie 1-4 actifs)\n`);

  if (doClear && !dryRun) {
    console.log("🧹 Truncate Client + dépendants (cascade)…");
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "AppelLog", "TempAssignment", "Rappel", "Client"
      RESTART IDENTITY CASCADE;
    `);
    console.log("✓ Base vidée\n");
  } else if (doClear && dryRun) {
    console.log("🔍 [dry-run] truncate sauté\n");
  }

  const created = [];
  const errors = [];

  for (const row of filtered) {
    const code = String(row["Code client"]).trim();
    const nom = String(row["Nom du client"]).trim();
    const niveau = GMS_PAT_GROUPS[row["Groupe client"]];
    const data = {
      code,
      nom: nom || code,
      type: "GMS",
      tel1: cleanPhone(row["Téléphone"]),
      joursAppel: convertDays(row["Jours de livraison"]),
      notes: buildNotes(row, niveau),
    };

    if (dryRun) {
      created.push({ ...data, niveau });
      continue;
    }

    try {
      await prisma.client.upsert({
        where: { code },
        update: {
          nom: data.nom,
          type: data.type,
          tel1: data.tel1,
          joursAppel: data.joursAppel,
          notes: data.notes,
        },
        create: data,
      });
      created.push(data);
    } catch (e) {
      errors.push({ code, nom, error: e.message });
    }
  }

  console.log(`\n${dryRun ? "🔍 [dry-run] " : "✅ "}Résultat:`);
  console.log(`  ${created.length} clients ${dryRun ? "à importer" : "importés"}`);
  if (errors.length) {
    console.log(`  ❌ ${errors.length} erreurs:`);
    errors.forEach((e) => console.log(`    • ${e.code} (${e.nom}): ${e.error}`));
  }

  if (dryRun) {
    console.log("\n📋 Aperçu des 3 premiers:");
    created.slice(0, 3).forEach((c) => {
      console.log(`\n  ${c.code} | ${c.nom}`);
      console.log(`    type: ${c.type}`);
      console.log(`    tel1: ${c.tel1}`);
      console.log(`    jours: ${c.joursAppel}`);
      console.log(`    notes: ${c.notes.replace(/\n/g, " · ")}`);
    });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
