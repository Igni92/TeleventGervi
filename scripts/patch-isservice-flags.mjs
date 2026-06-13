/**
 * Rattrapage one-shot : pose isService=true sur les lignes existantes sans
 * itemCode (prestation/location/refacturation — convention prisma/schema.prisma).
 * Le pipeline miroir ne posait jamais le flag avant le fix de lib/sapMirror.ts ;
 * ce script aligne le stock historique des 3 tables de lignes de vente.
 *
 * Aucun appel SAP — pur SQL local, idempotent (WHERE "isService"=false).
 *   Usage: node scripts/patch-isservice-flags.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — identique à backfill-docs.mjs ──
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

// Pool Supabase (session mode) limité à 15 clients — le dev server en tient
// déjà plusieurs. On se restreint à 2 connexions, écritures séquentielles.
const dbUrl = (() => {
  const u = g("DATABASE_URL");
  if (!u) return undefined;
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

const TABLES = ["SapInvoiceLine", "SapOrderLine", "SapCreditNoteLine"];

async function main() {
  for (const t of TABLES) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "${t}" SET "isService"=true WHERE "itemCode" IS NULL AND "isService"=false`,
    );
    console.log(`✅ ${t}: ${n} ligne(s) passée(s) isService=true`);
  }

  // Contrôle : COUNT(isService=true) doit = COUNT(itemCode IS NULL) sur chaque table.
  console.log("\nVérification :");
  for (const t of TABLES) {
    const [r] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE "isService")::int AS svc,
              COUNT(*) FILTER (WHERE "itemCode" IS NULL)::int AS noitem
       FROM "${t}"`,
    );
    const ok = r.svc === r.noitem ? "OK" : "⚠️ ÉCART";
    console.log(`   ${t}: ${r.total} lignes · isService=${r.svc} · itemCode NULL=${r.noitem} → ${ok}`);
  }
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
