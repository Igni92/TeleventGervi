/**
 * DDL + backfill idempotent — table "ClientCardCode" (audit B5).
 *
 * Store canonique des CardCodes SAP d'un client logique : code principal
 * (Client.code) + comptes secondaires (ClientDeliveryMode.sapCardCode). Permet
 * d'agréger/scoper sur TOUS les comptes d'un client (encours, pilotage…).
 *
 * Backfill non destructif (ON CONFLICT DO NOTHING — `cardCode` unique : un
 * compte SAP = un seul client logique). Ré-exécutable sans effet de bord.
 *
 * Usage :
 *   node scripts/ddl-client-cardcodes.mjs           → dry-run (montre le SQL)
 *   node scripts/ddl-client-cardcodes.mjs --apply   → crée la table + backfill
 *
 * Après --apply : `npx prisma generate` (le modèle ClientCardCode est déjà dans
 * schema.prisma) ; lib/clientCardCodes.ts lit alors la table (repli auto sinon).
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local) — modèle scripts/ddl-bp-credit.mjs ──
const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\\$/g, "$");
  }
}
const g = (k) => process.env[k] ?? env[k] ?? "";

const dbUrl = (() => {
  const u = g("DATABASE_URL");
  if (!u) return undefined;
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

const APPLY = process.argv.includes("--apply");
const SQL = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/manual/20260616_client_cardcodes.sql"),
  "utf8",
);

async function main() {
  console.log(`Mode : ${APPLY ? "APPLY (écriture)" : "DRY-RUN (aucune écriture — relancer avec --apply)"}\n`);
  console.log("── SQL prévu (prisma/migrations/manual/20260616_client_cardcodes.sql) ──");
  console.log(SQL.trim());

  if (!APPLY) {
    console.log("\nDRY-RUN terminé. Relancer avec --apply pour créer la table + backfill.");
    return;
  }

  await prisma.$executeRawUnsafe(SQL);
  const [{ n }] = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "ClientCardCode"');
  console.log(`\n✓ table "ClientCardCode" prête — ${n} ligne(s) après backfill.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
