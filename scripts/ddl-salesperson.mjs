/**
 * DDL + seed idempotent — table "SalesPerson" (audit B4).
 *
 * Référentiel des commerciaux SAP (SalesEmployeeCode ↔ SalesEmployeeName).
 * Seedé avec les commerciaux connus (lib/salespeople.ts) ; ensuite alimenté/
 * réactualisé par le miroir SAP (lib/sapMirror.ts → pullBusinessPartners).
 *
 * Usage :
 *   node scripts/ddl-salesperson.mjs           → dry-run (montre le SQL)
 *   node scripts/ddl-salesperson.mjs --apply   → crée la table + seed
 *
 * Après --apply : `npx prisma generate` (le modèle SalesPerson est déjà dans
 * schema.prisma), puis relancer une synchro BusinessPartners pour compléter.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

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
  path.resolve(process.cwd(), "prisma/migrations/manual/20260616_salesperson.sql"),
  "utf8",
);

async function main() {
  console.log(`Mode : ${APPLY ? "APPLY (écriture)" : "DRY-RUN (aucune écriture — relancer avec --apply)"}\n`);
  console.log("── SQL prévu (prisma/migrations/manual/20260616_salesperson.sql) ──");
  console.log(SQL.trim());

  if (!APPLY) {
    console.log("\nDRY-RUN terminé. Relancer avec --apply pour créer la table + seed.");
    return;
  }

  await prisma.$executeRawUnsafe(SQL);
  const [{ n }] = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "SalesPerson"');
  console.log(`\n✓ table "SalesPerson" prête — ${n} commercial(aux).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
