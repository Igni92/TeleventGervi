/**
 * Sonde : par quel moyen récupérer le PDF Crystal d'une facture sur CETTE base.
 *
 * Le Service Layer NE rend PAS les layouts Crystal. Ce script vérifie les voies
 * réalistes côté SAP :
 *   1) Le PDF est-il STOCKÉ en pièce jointe de la facture ? (→ téléchargeable via
 *      Attachments2) — le plus simple si oui.
 *   2) Version du Service Layer (indice de dispo d'un service d'impression récent).
 *   3) Entité ElectronicDocuments exposée ? (couche e-facture éventuelle).
 *
 * Usage (machine avec accès SAP + secrets dans .env.local / .env) :
 *   node scripts/probe-invoice-pdf.mjs            → scanne les factures récentes
 *   node scripts/probe-invoice-pdf.mjs 12345      → cible la facture DocEntry=12345
 */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v.replace(/\\\$/g, "$");
    }
  }
}
loadEnv(".env.local");
loadEnv(".env");

function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    const t = new URL(path, process.env.SAP_B1_BASE_URL + "/");
    const r = https.request(
      {
        hostname: t.hostname, port: t.port || 443, path: t.pathname + t.search, method,
        rejectUnauthorized: process.env.SAP_B1_TLS_INSECURE !== "1",
        headers: { "Content-Type": "application/json", ...(opts.cookies ? { Cookie: opts.cookies } : {}) },
      },
      (resp) => {
        let d = ""; resp.on("data", (c) => (d += c));
        resp.on("end", () => { let p = d; try { p = JSON.parse(d); } catch { /* texte */ } res({ status: resp.statusCode, body: p, headers: resp.headers }); });
      },
    );
    r.on("error", rej);
    if (opts.body) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

const login = await req("POST", "Login", {
  body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD },
});
if (login.status !== 200) { console.error("❌ LOGIN FAIL", login.status, login.body); process.exit(1); }
const cookies = (login.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
console.log("✅ Connecté — Service Layer Version :", login.body?.Version ?? "(inconnue)");

const arg = process.argv[2];

// 1) Pièces jointes sur les factures
console.log("\n[1] Pièces jointes sur les factures (AttachmentEntry)…");
let targets = [];
if (arg) {
  const one = await req("GET", `Invoices(${arg})?$select=DocEntry,DocNum,AttachmentEntry`, { cookies });
  if (one.status === 200) targets = [one.body];
  else console.log("  facture", arg, "→", one.status, one.body?.error?.message?.value ?? "");
} else {
  const list = await req("GET", "Invoices?$top=20&$orderby=DocEntry desc&$select=DocEntry,DocNum,AttachmentEntry", { cookies });
  targets = list.body?.value || [];
}
const withAtt = targets.filter((i) => i.AttachmentEntry && i.AttachmentEntry > 0);
console.log(`  ${targets.length} factures examinées, ${withAtt.length} avec une pièce jointe.`);

if (withAtt.length) {
  const sample = withAtt[0];
  console.log(`  → Détail Attachments2(${sample.AttachmentEntry}) de la facture #${sample.DocNum} :`);
  const att = await req("GET", `Attachments2(${sample.AttachmentEntry})`, { cookies });
  const lines = att.body?.Attachments2_Lines || [];
  for (const l of lines) {
    console.log(`     • ${l.FileName}.${l.FileExtension}  (${l.AttachmentDate ?? "?"})  src=${l.SourcePath ?? ""}`);
  }
  const pdfs = lines.filter((l) => String(l.FileExtension).toLowerCase() === "pdf");
  console.log(pdfs.length
    ? `  ✅ PDF(s) présents en pièce jointe → récupérables via Attachments2(${sample.AttachmentEntry})/$value (Option 1).`
    : "  ⚠️ Pièces jointes présentes mais aucune en .pdf.");
} else {
  console.log("  ⚠️ Aucune facture récente n'a de PDF attaché → le PDF Crystal n'est PAS stocké côté SAP.");
  console.log("     → il faudra le RENDRE (Option 2 : service d'export Crystal .NET).");
}

// 2) Entité ElectronicDocuments (couche e-facture éventuelle)
console.log("\n[2] Entité ElectronicDocuments exposée ?");
const edoc = await req("GET", "ElectronicDocuments?$top=1", { cookies });
console.log("  →", edoc.status === 200 ? "OUI (couche e-facture présente — à explorer)" : `non (${edoc.status})`);

await req("POST", "Logout", { cookies });
console.log("\nRésumé : envoie-moi la sortie ci-dessus + la version SAP B1 (HANA ou SQL ?) et je te donne la méthode exacte.");
