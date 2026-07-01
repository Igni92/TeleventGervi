/**
 * DDL idempotent — Rôle agréeur gérable depuis l'UI.
 *
 * Ajoute la colonne "User"."isAgreeur" (BOOLEAN, défaut false). Un admin / la
 * direction peut alors désigner / retirer un « agréeur » depuis la section
 * « Équipe » de l'écran Effectifs (/commerciaux), sans redéploiement.
 *
 * L'agréeur peut UNIQUEMENT « passer » une commande fournisseur en entrée
 * marchandise (réception d'une commande → PurchaseDeliveryNote, cf.
 * /api/sap/purchase-orders/receive + lib/permissions.requireCanReceivePurchaseOrder).
 * Il ne peut créer NI une commande fournisseur NI une entrée marchandise.
 *
 * ⚠️ Colonne lue/écrite en $queryRawUnsafe (le client Prisma généré peut être
 *    en retard — EPERM dev server). Convention identique au reste du repo
 *    (cf. ddl-user-ispreparateur.mjs, ddl-user-isadmin.mjs).
 *
 *   Usage : node scripts/ddl-user-isagreeur.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle ddl-user-isadmin.mjs ──
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
const dbUrl = (() => {
  const u = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL introuvable (.env/.env.local)");
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  console.log("══ DDL User.isAgreeur (rôle agréeur gérable en UI) ══\n");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAgreeur" BOOLEAN NOT NULL DEFAULT false;
  `);
  console.log('✅ Colonne "User"."isAgreeur" (BOOLEAN, défaut false)');

  // ── État final ──
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "User")::int AS comptes,
           (SELECT COUNT(*) FROM "User" WHERE "isAgreeur" = true)::int AS agreeurs;
  `);
  console.log("\n📊 Comptes :", state);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
