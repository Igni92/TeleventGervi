/** Compte les docs SAP sur 365j (volume du backfill). Lecture seule. */
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
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(o.cookie ? { Cookie: o.cookie } : {}) } },
      (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, body: b, headers: x.headers }); }); });
    r.on("error", rej); if (o.body) r.write(JSON.stringify(o.body)); r.end();
  });
}
async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  if (login.status !== 200) { console.error("LOGIN KO"); return; }
  const set = login.headers["set-cookie"];
  const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  const yearAgo = new Date(); yearAgo.setDate(yearAgo.getDate() - 365);
  const FROM = `'${yearAgo.toISOString().slice(0, 10)}'`;
  for (const ent of ["Orders", "Invoices", "CreditNotes", "PurchaseDeliveryNotes"]) {
    const r = await req(`${ent}/$count?$filter=DocDate ge ${encodeURIComponent(FROM)}`, { cookie });
    console.log(`${ent} depuis ${FROM}:`, r.status, r.body);
  }
  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
