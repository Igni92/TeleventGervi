/**
 * Diagnostic SAP lecture seule — la requête mirror corrigée passe-t-elle, et
 * AMARNE a-t-il des commandes côté SAP ? N'écrit rien dans SAP (Logout en fin).
 *   Usage: node scripts/diag-sap-orders.mjs [CARDCODE]   (défaut: AMARNE)
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

// .env minimal (node ne le charge pas tout seul) — .env.local écrase .env
const env = {};
for (const file of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    v = v.replace(/\\\$/g, "$"); // Next.js échappe le $ littéral en \$ dans .env
    env[m[1]] = v;
  }
}
const get = (k) => process.env[k] ?? env[k] ?? "";

const BASE = get("SAP_B1_BASE_URL");
const COMPANY = get("SAP_B1_COMPANY_DB");
const USER = get("SAP_B1_USERNAME");
const PASS = get("SAP_B1_PASSWORD");
const INSECURE = get("SAP_B1_TLS_INSECURE") === "1";
const CARD = (process.argv[2] || "AMARNE").replace(/'/g, "''");

const agent = new https.Agent({ rejectUnauthorized: !INSECURE, keepAlive: true });

function req(pathname, { method = "GET", body, cookie } = {}) {
  const url = new URL(pathname.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((resolve, reject) => {
    const r = https.request(
      { hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method, agent,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => {
        let b = d; try { b = JSON.parse(d); } catch {} resolve({ status: res.statusCode, headers: res.headers, body: b }); }); });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  if (!BASE || !COMPANY) { console.error("⚠️ Variables SAP_B1_* introuvables dans .env"); return; }
  const login = await req("Login", { method: "POST", body: { CompanyDB: COMPANY, UserName: USER, Password: PASS } });
  if (login.status !== 200) { console.error("❌ LOGIN KO", login.status, JSON.stringify(login.body).slice(0, 300)); return; }
  const set = login.headers["set-cookie"];
  const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("✅ Login OK —", COMPANY);

  const mirrorQueries = [
    ["Orders (sans GrossProfit en-tête)", "Orders?$select=DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate,DocumentLines&$orderby=DocEntry desc&$top=2"],
    ["Invoices (sans GrossProfit en-tête)", "Invoices?$select=DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate,DocumentLines&$orderby=DocEntry desc&$top=2"],
    ["PurchaseDeliveryNotes", "PurchaseDeliveryNotes?$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled,UpdateDate,DocumentLines&$orderby=DocEntry desc&$top=2"],
  ];
  for (const [label, q] of mirrorQueries) {
    const r = await req(q, { cookie });
    console.log(`\n[1] Requête mirror corrigée — ${label} → status`, r.status);
    if (r.status >= 400) console.log("    ❌ ERREUR SAP:", JSON.stringify(r.body?.error ?? r.body).slice(0, 300));
    else console.log("    ✅ OK:", (r.body.value || []).map((o) => ({ DocNum: o.DocNum, DocDate: (o.DocDate || "").slice(0, 10), lignes: (o.DocumentLines || []).length })));
  }

  // Où vit la commande d'AMARNE ? On compare Orders / DeliveryNotes / Invoices.
  const sel = "$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,UpdateDate,DocTotal&$orderby=DocEntry desc&$top=6";
  for (const [label, entity] of [["Orders (bon de commande)", "Orders"], ["DeliveryNotes (BL livraison)", "DeliveryNotes"], ["Invoices (facture)", "Invoices"]]) {
    const r = await req(`${entity}?$filter=CardCode eq '${CARD}'&${sel}`, { cookie });
    console.log(`\n[2] ${CARD} dans ${label} → status`, r.status);
    if (r.status >= 400) console.log("    ❌", JSON.stringify(r.body?.error ?? r.body).slice(0, 300));
    else if (!(r.body.value || []).length) console.log("    (aucun)");
    else console.log("    ", r.body.value.map((o) => ({ DocNum: o.DocNum, DocDate: (o.DocDate || "").slice(0, 10), DueDate: (o.DocDueDate || "").slice(0, 10), Update: (o.UpdateDate || "").slice(0, 10), Total: o.DocTotal })));
  }

  for (const entity of ["Orders", "DeliveryNotes", "Invoices"]) {
    const r = await req(`${entity}/$count`, { cookie });
    console.log(`[3] Nb total ${entity} dans SAP:`, r.status, r.body);
  }

  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
