/**
 * DDL idempotent — table "UserCommercial" : mapping email compte ↔ trigramme
 * commercial SAP (slpName). Socle de la gestion des droits (lib/permissions.ts) :
 * « un commercial ne voit que ses propres données » — sauf admins
 * (jm.gunslay@gervifrais.com, m.mandine@gervifrais.com) qui voient tout.
 *
 * SEED best-effort :
 *   - mappings canoniques (miroir de lib/salespeople.ts — source SAP SalesPersons),
 *   - + emails @gervifrais.com du modèle User (next-auth) dont les initiales
 *     déduites (1er segment + 1res lettres des suivants : jm.gunslay → JMG)
 *     correspondent EXACTEMENT à un slpName actif du miroir SAP.
 *
 * Usage :
 *   node scripts/ddl-user-commercial.mjs           → dry-run (montre tout, n'écrit rien)
 *   node scripts/ddl-user-commercial.mjs --apply   → crée la table + insère les mappings évidents
 *
 * Bloc Prisma correspondant (schema.prisma NON modifiable tant que generate est
 * bloqué — accès via $queryRawUnsafe uniquement) :
 *
 *   model UserCommercial {
 *     email     String   @id
 *     slpName   String
 *     createdAt DateTime @default(now())
 *   }
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle scripts/backfill-docs.mjs ──
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

// Pool Supabase limité — 2 connexions max (cf. backfill-docs.mjs).
const dbUrl = (() => {
  const u = g("DATABASE_URL");
  if (!u) return undefined;
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

const APPLY = process.argv.includes("--apply");

const DDL = `
CREATE TABLE IF NOT EXISTS "UserCommercial" (
  "email"     TEXT NOT NULL,
  "slpName"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserCommercial_pkey" PRIMARY KEY ("email")
);`;

/** Mappings canoniques — miroir de lib/salespeople.ts (SAP SalesPersons). */
const CANONICAL = [
  { email: "m.mandine@gervifrais.com", slpName: "MM" },   // admin, mappé quand même
  { email: "jm.gunslay@gervifrais.com", slpName: "JMG" }, // admin, mappé quand même
  { email: "m.essombe@gervifrais.com", slpName: "AG" },   // cf. lib/salespeople.ts (code 7)
];

/** Initiales déduites d'un email : "jm.gunslay@…" → "JMG", "m.mandine@…" → "MM". */
function initialsFromEmail(email) {
  const local = email.split("@")[0] ?? "";
  const segs = local.split(/[._-]+/).filter(Boolean);
  if (segs.length === 0) return null;
  // 1er segment entier (déjà des initiales : "m", "jm") + 1re lettre des suivants.
  return (segs[0] + segs.slice(1).map((s) => s[0]).join("")).toUpperCase();
}

async function main() {
  console.log(`Mode : ${APPLY ? "APPLY (écriture)" : "DRY-RUN (aucune écriture — relancer avec --apply)"}\n`);

  // 1) slpName distincts du miroir (SapOrder ∪ SapInvoice) — tout l'historique.
  const slpRows = await prisma.$queryRawUnsafe(`
    SELECT s."slpName", SUM(s.n)::int AS n, MAX(s.last) AS last
    FROM (
      SELECT "slpName", COUNT(*) AS n, MAX("docDate") AS last
      FROM "SapOrder" WHERE "slpName" IS NOT NULL AND "slpName" <> '' GROUP BY 1
      UNION ALL
      SELECT "slpName", COUNT(*) AS n, MAX("docDate") AS last
      FROM "SapInvoice" WHERE "slpName" IS NOT NULL AND "slpName" <> '' GROUP BY 1
    ) s GROUP BY 1 ORDER BY n DESC`);
  const slpSet = new Set(slpRows.map((r) => r.slpName));
  console.log("── slpName distincts du miroir SAP ──");
  for (const r of slpRows) {
    console.log(`   ${String(r.slpName).padEnd(5)} ${String(r.n).padStart(6)} docs   dernier: ${new Date(r.last).toISOString().slice(0, 10)}`);
  }

  // 2) Emails @gervifrais.com du modèle User (next-auth) — s'il existe.
  let users = [];
  try {
    users = await prisma.$queryRawUnsafe(
      `SELECT "email", "name" FROM "User" WHERE "email" ILIKE '%@gervifrais.com' ORDER BY "email"`,
    );
  } catch {
    console.log("\n(table User absente — seed limité aux mappings canoniques)");
  }
  console.log("\n── Comptes User @gervifrais.com ──");
  if (users.length === 0) console.log("   (aucun)");
  for (const u of users) console.log(`   ${u.email}  (${u.name ?? "—"})`);

  // 3) Mappings évidents : canoniques + initiales User matchant un slpName du miroir.
  const planned = new Map(); // email(lower) → { slpName, source }
  for (const c of CANONICAL) planned.set(c.email.toLowerCase(), { slpName: c.slpName, source: "canonique (lib/salespeople.ts)" });
  for (const u of users) {
    const email = String(u.email).toLowerCase();
    if (planned.has(email)) continue;
    const ini = initialsFromEmail(email);
    if (ini && slpSet.has(ini)) planned.set(email, { slpName: ini, source: `initiales (${email.split("@")[0]} → ${ini})` });
    else console.log(`   ⚠ non mappé automatiquement : ${email}${ini ? ` (initiales ${ini} ∉ slpName miroir)` : ""}`);
  }

  console.log("\n── Mappings prévus (évidents uniquement) ──");
  for (const [email, m] of planned) console.log(`   ${email.padEnd(34)} → ${m.slpName.padEnd(4)} [${m.source}]`);
  const orphans = slpRows.filter((r) => !Array.from(planned.values()).some((m) => m.slpName === r.slpName));
  if (orphans.length) {
    console.log("\n── slpName du miroir SANS email mappé (à compléter à la main) ──");
    for (const r of orphans) console.log(`   ${r.slpName}  (${r.n} docs) — INSERT INTO "UserCommercial"("email","slpName") VALUES ('…@gervifrais.com','${r.slpName}');`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN terminé. Relancer avec --apply pour créer la table + insérer ces mappings.");
    return;
  }

  // 4) Application : DDL + INSERT idempotents (ON CONFLICT DO NOTHING — ne
  //    clobbe jamais un mapping ajusté à la main).
  await prisma.$executeRawUnsafe(DDL);
  console.log('\n✓ table "UserCommercial" présente');
  let inserted = 0;
  for (const [email, m] of planned) {
    const n = await prisma.$executeRawUnsafe(
      `INSERT INTO "UserCommercial" ("email", "slpName") VALUES ($1, $2) ON CONFLICT ("email") DO NOTHING`,
      email, m.slpName,
    );
    inserted += Number(n);
  }
  console.log(`✓ ${inserted} mapping(s) inséré(s) (${planned.size - inserted} déjà présent(s))`);
  const final = await prisma.$queryRawUnsafe(`SELECT "email", "slpName" FROM "UserCommercial" ORDER BY "email"`);
  console.log("\n── Contenu final de UserCommercial ──");
  for (const r of final) console.log(`   ${String(r.email).padEnd(34)} → ${r.slpName}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
