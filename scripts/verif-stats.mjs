/**
 * Vérification du rapport comptable — reproduit en SQL DIRECT les agrégats
 * clés du miroir SAP et vérifie leur plausibilité :
 *   - CA net mensuel 2026  = Σ SapInvoice.docTotal − Σ SapCreditNote.docTotal
 *   - Marge nette mensuelle = Σ grossProfit (factures − avoirs)
 *   - Top 5 clients CA net 2026
 *   - Sanity checks : valeurs non nulles, marge < CA, marge % raisonnable,
 *     grossProfit pas null/0 partout.
 *
 * Lecture seule — ne modifie RIEN. Pool Supabase session mode = 15 clients max
 * → connection_limit=2 (modèle : scripts/backfill-docs.mjs).
 *   Usage: node scripts/verif-stats.mjs [--year 2026]
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
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

const yearIdx = process.argv.indexOf("--year");
const YEAR = yearIdx > -1 ? parseInt(process.argv[yearIdx + 1]) : 2026;
const FROM = `${YEAR}-01-01`;
const TO = `${YEAR + 1}-01-01`;

const eur = (n) => (n == null ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €");
const pct = (n) => (n == null ? "—" : n.toFixed(1) + " %");

async function main() {
  const anomalies = [];

  // ── 0. Volumétrie du miroir (sanity de base) ──
  const [vol] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM "SapInvoice"    WHERE "docDate" >= $1::date AND "docDate" < $2::date AND "cancelled" = false)::int AS invoices,
      (SELECT COUNT(*) FROM "SapCreditNote" WHERE "docDate" >= $1::date AND "docDate" < $2::date AND "cancelled" = false)::int AS credit_notes,
      (SELECT COUNT(*) FROM "SapInvoice"    WHERE "docDate" >= $1::date AND "docDate" < $2::date AND "cancelled" = false AND ("grossProfit" IS NULL OR "grossProfit" = 0))::int AS inv_gp_zero,
      (SELECT MAX("docDate")::text FROM "SapInvoice") AS last_invoice
  `, FROM, TO);
  console.log(`\n=== Miroir SAP — vérification rapport comptable ${YEAR} ===`);
  console.log(`Factures ${YEAR} (non annulées) : ${vol.invoices} · Avoirs : ${vol.credit_notes} · Dernière facture : ${vol.last_invoice}`);
  if (vol.invoices === 0) anomalies.push(`AUCUNE facture ${YEAR} dans le miroir — rapport vide !`);
  if (vol.inv_gp_zero === vol.invoices && vol.invoices > 0) {
    anomalies.push(`grossProfit NULL/0 sur 100 % des factures ${YEAR} — marge inutilisable.`);
  } else if (vol.invoices > 0 && vol.inv_gp_zero / vol.invoices > 0.2) {
    anomalies.push(`grossProfit NULL/0 sur ${vol.inv_gp_zero}/${vol.invoices} factures ${YEAR} (>20 %) — marge sous-estimée ?`);
  }

  // ── 1. CA net + marge nette mensuels (= logique du rapport annuel) ──
  const monthly = await prisma.$queryRawUnsafe(`
    WITH inv AS (
      SELECT date_trunc('month', "docDate") AS m,
             SUM("docTotal") AS ca, SUM(COALESCE("grossProfit", 0)) AS marge
      FROM "SapInvoice"
      WHERE "cancelled" = false AND "docDate" >= $1::date AND "docDate" < $2::date
      GROUP BY 1
    ), cn AS (
      SELECT date_trunc('month', "docDate") AS m,
             SUM("docTotal") AS ca, SUM(COALESCE("grossProfit", 0)) AS marge
      FROM "SapCreditNote"
      WHERE "cancelled" = false AND "docDate" >= $1::date AND "docDate" < $2::date
      GROUP BY 1
    )
    SELECT to_char(COALESCE(i.m, c.m), 'YYYY-MM') AS mois,
           (COALESCE(i.ca, 0)    - COALESCE(c.ca, 0))::float8    AS ca_net,
           (COALESCE(i.marge, 0) - COALESCE(c.marge, 0))::float8 AS marge_nette
    FROM inv i FULL OUTER JOIN cn c ON c.m = i.m
    ORDER BY 1
  `, FROM, TO);

  console.log(`\n— CA net & marge nette mensuels ${YEAR} (factures − avoirs, HT) —`);
  console.log("Mois     | CA net        | Marge nette   | Marge %");
  let totCa = 0, totMarge = 0;
  for (const r of monthly) {
    const margePct = r.ca_net !== 0 ? (100 * r.marge_nette) / r.ca_net : null;
    totCa += r.ca_net; totMarge += r.marge_nette;
    console.log(`${r.mois}  | ${eur(r.ca_net).padStart(13)} | ${eur(r.marge_nette).padStart(13)} | ${pct(margePct).padStart(7)}`);
    // Sanity par mois (passé uniquement — le mois courant est partiel mais doit rester cohérent)
    if (r.ca_net <= 0) anomalies.push(`${r.mois} : CA net ≤ 0 (${eur(r.ca_net)}).`);
    if (r.marge_nette >= r.ca_net && r.ca_net > 0) anomalies.push(`${r.mois} : marge ≥ CA (${eur(r.marge_nette)} vs ${eur(r.ca_net)}).`);
    if (margePct != null && (margePct < 1 || margePct > 50)) {
      anomalies.push(`${r.mois} : marge ${pct(margePct)} hors plage plausible [1–50 %] pour un grossiste fruits.`);
    }
  }
  const totPct = totCa !== 0 ? (100 * totMarge) / totCa : null;
  console.log(`TOTAL    | ${eur(totCa).padStart(13)} | ${eur(totMarge).padStart(13)} | ${pct(totPct).padStart(7)}`);
  if (monthly.length === 0) anomalies.push(`Aucun mois agrégé en ${YEAR}.`);

  // ── 2. Top 5 clients CA net ${YEAR} ──
  const top = await prisma.$queryRawUnsafe(`
    SELECT x."cardCode",
           COALESCE(MAX(x."cardName"), x."cardCode") AS nom,
           SUM(x.ca)::float8 AS ca_net
    FROM (
      SELECT "cardCode", "cardName", "docTotal" AS ca
      FROM "SapInvoice"
      WHERE "cancelled" = false AND "docDate" >= $1::date AND "docDate" < $2::date
      UNION ALL
      SELECT "cardCode", "cardName", -"docTotal"
      FROM "SapCreditNote"
      WHERE "cancelled" = false AND "docDate" >= $1::date AND "docDate" < $2::date
    ) x
    GROUP BY x."cardCode"
    ORDER BY 3 DESC
    LIMIT 5
  `, FROM, TO);

  console.log(`\n— Top 5 clients CA net ${YEAR} —`);
  for (const [i, r] of top.entries()) {
    console.log(`${i + 1}. ${r.cardCode.padEnd(10)} ${String(r.nom).slice(0, 35).padEnd(35)} ${eur(r.ca_net).padStart(13)}`);
    if (totCa > 0 && r.ca_net > totCa * 0.5) anomalies.push(`Client ${r.cardCode} = >50 % du CA — concentration suspecte ou doublon.`);
  }
  if (top.length === 0) anomalies.push("Top clients vide.");

  // ── 3. Verdict ──
  if (anomalies.length === 0) {
    console.log("\n✅ Aucune anomalie : chiffres non nuls, marge < CA, marge % plausible.");
  } else {
    console.log(`\n⚠️ ${anomalies.length} anomalie(s) détectée(s) :`);
    for (const a of anomalies) console.log("   - " + a);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
