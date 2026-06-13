/**
 * Rejoue les requêtes EXACTES du miroir (lib/sapMirror.ts) contre SAP.
 * Mêmes $select / $filter (dates quotées) / $orderby que le code corrigé.
 * Lecture seule — valide que le prochain backfill/tick passera.
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

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
const BASE = g("SAP_B1_BASE_URL");
const agent = new https.Agent({ rejectUnauthorized: g("SAP_B1_TLS_INSECURE") !== "1", keepAlive: true });
function req(p, o = {}) {
  const u = new URL(p.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((res, rej) => {
    const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: o.method || "GET", agent,
      headers: { "Content-Type": "application/json", Accept: "application/json", Prefer: "odata.maxpagesize=100", ...(o.cookie ? { Cookie: o.cookie } : {}) } },
      (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, body: b, headers: x.headers }); }); });
    r.on("error", rej); if (o.body) r.write(JSON.stringify(o.body)); r.end();
  });
}

// === Copie EXACTE des constantes de lib/sapMirror.ts (post-fix) ===
const COMMON_SELECT_DOC =
  "DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate";
const SELECT_DOC_LINES = `$select=${COMMON_SELECT_DOC},DocumentLines`;
const SELECT_PDN_LINES =
  "$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled,UpdateDate,DocumentLines";
const odataDate = (d) => `'${d.toISOString().slice(0, 10)}'`;

const yearAgo = new Date(); yearAgo.setDate(yearAgo.getDate() - 365);
const FROM = odataDate(yearAgo);

const QUERIES = [
  ["BusinessPartners (incrémental ge aujourd'hui)",
    "BusinessPartners?$select=CardCode,CardName,CardType,GroupCode,SalesPersonCode,EmailAddress,Phone1,Valid,UpdateDate"
    + `&$filter=(CardType eq 'cCustomer' or CardType eq 'cSupplier') and UpdateDate ge ${odataDate(new Date())}`],
  ["Invoices (backfill 365j)", `Invoices?${SELECT_DOC_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`],
  ["Orders (backfill 365j)", `Orders?${SELECT_DOC_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`],
  ["CreditNotes (backfill 365j)", `CreditNotes?${SELECT_DOC_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`],
  ["PurchaseDeliveryNotes (backfill 365j)", `PurchaseDeliveryNotes?${SELECT_PDN_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`],
];

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  if (login.status !== 200) { console.error("LOGIN KO", login.status); return; }
  const set = login.headers["set-cookie"];
  const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login OK —", g("SAP_B1_COMPANY_DB"), "\n");
  let allOk = true;
  for (const [label, q] of QUERIES) {
    const r = await req(q, { cookie });
    const n = r.status < 400 ? (r.body.value || []).length : 0;
    const sampleLines = n > 0 ? (r.body.value[0].DocumentLines || []).length : "—";
    if (r.status >= 400) allOk = false;
    console.log(`${r.status < 400 ? "✅" : "❌"} ${r.status}  ${label}  (1ʳᵉ page: ${n} docs, lignes du 1er: ${sampleLines})`
      + (r.status >= 400 ? "\n      " + JSON.stringify(r.body?.error?.message?.value ?? r.body).slice(0, 200) : ""));
  }
  console.log(allOk ? "\n🎉 TOUTES les requêtes du miroir passent — le backfill peut tourner." : "\n⚠️ Il reste des erreurs ci-dessus.");
  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
