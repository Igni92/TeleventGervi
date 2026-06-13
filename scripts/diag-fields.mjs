/** Inspecte les champs marge réellement dispo sur Invoices/Orders (en-tête + lignes). Lecture seule. */
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
function req(p, { method = "GET", body, cookie } = {}) {
  const u = new URL(p.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((res, rej) => { const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, agent, headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, headers: x.headers, body: b }); }); }); r.on("error", rej); if (body) r.write(JSON.stringify(body)); r.end(); });
}
const pick = (obj, re) => Object.keys(obj || {}).filter((k) => re.test(k));
async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  const set = login.headers["set-cookie"]; const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login", login.status);
  for (const ent of ["Invoices", "Orders"]) {
    const r = await req(`${ent}?$top=1&$orderby=DocEntry desc`, { cookie });
    const doc = r.body.value?.[0] || {};
    const line = (doc.DocumentLines || [])[0] || {};
    console.log(`\n=== ${ent} ===`);
    console.log("  en-tête marge:", pick(doc, /gross|profit|margin/i));
    console.log("  ligne marge/coût:", pick(line, /gross|profit|stock|price|cost/i));
    console.log("  ligne — exemples valeurs:", JSON.stringify({
      ItemCode: line.ItemCode, Quantity: line.Quantity, LineTotal: line.LineTotal,
      StockPrice: line.StockPrice, GrossProfit: line.GrossProfit, GrossProfitTotal: line.GrossProfitTotal,
    }));
  }
  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
