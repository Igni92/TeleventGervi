/** Teste le format de date accepté par ce Service Layer dans $filter. Lecture seule. */
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
      (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, headers: x.headers, body: b }); }); });
    r.on("error", rej); if (o.body) r.write(JSON.stringify(o.body)); r.end();
  });
}

const F = (s) => "Invoices?$select=DocEntry,DocDate&$filter=" + encodeURIComponent(s) + "&$top=1";
const VARIANTS = [
  ["non quoté   DocDate ge 2025-06-11", F("DocDate ge 2025-06-11")],
  ["quoté       DocDate ge '2025-06-11'", F("DocDate ge '2025-06-11'")],
  ["datetime    DocDate ge 2025-06-11T00:00:00Z", F("DocDate ge 2025-06-11T00:00:00Z")],
  ["quoté+heure DocDate ge '2025-06-11T00:00:00'", F("DocDate ge '2025-06-11T00:00:00'")],
  ["quoté combo DocDate ge '2025-06-11' and UpdateDate ge '2026-06-10'", F("DocDate ge '2025-06-11' and UpdateDate ge '2026-06-10'")],
];

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  if (login.status !== 200) { console.error("LOGIN KO", login.status); return; }
  const set = login.headers["set-cookie"];
  const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login OK\n");
  for (const [label, q] of VARIANTS) {
    const r = await req(q, { cookie });
    console.log(`${r.status < 400 ? "✅" : "❌"} ${r.status}  ${label}` +
      (r.status >= 400 ? "   " + JSON.stringify(r.body?.error?.message?.value ?? "").slice(0, 100)
                       : "   → " + JSON.stringify(r.body.value)));
  }
  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
