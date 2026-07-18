/**
 * Réconciliation du REGISTRE des lots ↔ stock physique (ÉCRÊTAGE).
 *
 * Règle métier : la somme des quantités par lot d'un article (registre
 * `ProductBatch.quantity`, cf. lib/lotLedger) ne peut PAS dépasser son stock
 * PHYSIQUE (somme `ProductStock.inStock`, entrepôts télévente). Ex. réel :
 * 396 kg en stock, impossible d'avoir 308 + 352 + 210 + 88 au registre.
 *
 * Quand elle le dépasse, le surplus est FANTÔME (dérive d'avant le suivi complet
 * des mouvements, ventes passées directement dans SAP jamais débitées ici) : il
 * est retiré des lots les PLUS ANCIENS d'abord (FIFO — en réalité déjà vendus),
 * plancher 0. Stock physique nul → tous les lots à 0 (« pas de stock → pas de
 * lot »), cas particulier du même écrêtage. Jamais d'écriture À LA HAUSSE.
 *
 * La synchro produits fait désormais ce même écrêtage toutes les 30 min
 * (reconcileLedgerToPhysical) — ce script sert au diagnostic et à la purge
 * manuelle. Garde anti-course : un article dont un lot a bougé (ledgerAt) il y a
 * moins de 60 min est sauté (réception/vente en cours).
 *
 * ⚠️ DRY-RUN par défaut : n'écrit RIEN. Passer `--apply` pour appliquer.
 *
 *   node scripts/reconcile-lot-ledger.mjs           # aperçu (dry-run)
 *   node scripts/reconcile-lot-ledger.mjs --apply   # applique l'écrêtage
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) ──
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

const APPLY = process.argv.includes("--apply");
const QUIET_MS = 60 * 60_000; // garde anti-course : mouvement registre < 60 min → article sauté
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

/** Miroir pur de planLedgerTrim (lib/gervifrais-calc — script standalone, pas de TS). */
function planLedgerTrim(lots, physicalStock) {
  const round3 = (n) => Math.round(n * 1000) / 1000;
  const stock = Math.max(0, physicalStock);
  const total = lots.reduce((s, l) => s + Math.max(0, Number(l.quantity)), 0);
  let surplus = round3(total - stock);
  if (surplus <= 0) return [];
  const time = (l) => {
    const t = l.admissionDate ? new Date(l.admissionDate).getTime() : NaN;
    return Number.isFinite(t) ? t : Infinity;
  };
  const ordered = [...lots].sort(
    (a, b) => time(a) - time(b)
      || String(a.batchNumber ?? "").localeCompare(String(b.batchNumber ?? "")),
  );
  const trims = [];
  for (const lot of ordered) {
    if (surplus <= 0) break;
    if (lot.quantity <= 0) continue;
    const cut = Math.min(Number(lot.quantity), surplus);
    surplus = round3(surplus - cut);
    trims.push({ lot, quantity: round3(Number(lot.quantity) - cut) });
  }
  return trims;
}

async function main() {
  // Tous les lots au registre > 0, avec le stock physique de leur article.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT b."id", b."productId", p."itemCode", b."batchNumber", b."quantity",
            b."admissionDate", b."ledgerAt",
            COALESCE(s."stock", 0)::float8 AS "physical"
       FROM "ProductBatch" b
       JOIN "Product" p ON p."id" = b."productId"
       LEFT JOIN (SELECT "productId", SUM("inStock") AS "stock"
                    FROM "ProductStock" GROUP BY "productId") s
         ON s."productId" = b."productId"
      WHERE b."quantity" > 0
      ORDER BY p."itemCode", b."admissionDate" NULLS LAST, b."batchNumber";`,
  );

  const byProduct = new Map();
  for (const r of rows) {
    const cur = byProduct.get(r.productId);
    if (cur) cur.push(r); else byProduct.set(r.productId, [r]);
  }

  const now = Date.now();
  const plans = [];
  let skippedRecent = 0;
  for (const lots of byProduct.values()) {
    const physical = Number(lots[0].physical);
    const total = lots.reduce((s, l) => s + Number(l.quantity), 0);
    if (total <= physical + 1e-6) continue;                      // registre ≤ stock : sain
    if (lots.some((l) => l.ledgerAt && now - new Date(l.ledgerAt).getTime() < QUIET_MS)) {
      skippedRecent++;
      continue;
    }
    const trims = planLedgerTrim(lots, physical);
    if (trims.length) plans.push({ itemCode: lots[0].itemCode, physical, total, trims });
  }

  if (plans.length === 0) {
    console.log("✅ Registre propre : aucun article dont la somme des lots dépasse le stock physique.");
    if (skippedRecent) console.log(`   (${skippedRecent} article(s) sauté(s) — mouvement registre < 60 min, relancer plus tard.)`);
    return;
  }

  console.log(`${APPLY ? "🧹 APPLY" : "🔎 DRY-RUN"} — ${plans.length} article(s) à écrêter (somme lots > stock physique) :\n`);
  for (const p of plans) {
    console.log(`  ${p.itemCode} — registre ${p.total} > stock physique ${p.physical} :`);
    for (const t of p.trims) {
      console.log(`    ${String(t.lot.batchNumber).padEnd(12)} ${Number(t.lot.quantity)} → ${t.quantity}`);
    }
  }
  if (skippedRecent) console.log(`\n  (${skippedRecent} article(s) sauté(s) — mouvement registre < 60 min.)`);

  if (!APPLY) {
    console.log(`\nAperçu uniquement. Relance avec --apply pour écrêter ces ${plans.length} article(s).`);
    return;
  }

  let updated = 0;
  for (const p of plans) {
    for (const t of p.trims) {
      await prisma.productBatch.update({ where: { id: t.lot.id }, data: { quantity: t.quantity } });
      updated++;
    }
  }
  console.log(`\n✅ ${updated} lot(s) écrêté(s) sur ${plans.length} article(s).`);
}

main()
  .catch((e) => { console.error("❌ Réconciliation échouée:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
