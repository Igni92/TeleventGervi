/** Trouve la forme d'$expand acceptée par ce Service Layer. Lecture seule. */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    v = v.replace(/\\\$/g, "$");
    env[m[1]] = v;
  }
}
const get = (k) => process.env[k] ?? env[k] ?? "";
const BASE = get("SAP_B1_BASE_URL"), COMPANY = get("SAP_B1_COMPANY_DB");
const agent = new https.Agent({ rejectUnauthorized: get("SAP_B1_TLS_INSECURE") !== "1" ? true : false, keepAlive: true });

function req(pathname, { method = "GET", body, cookie } = {}) {
  const url = new URL(pathname.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method, agent,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} resolve({ status: res.statusCode, headers: res.headers, body: b }); }); });
    r.on("error", reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

const VARIANTS = [
  ["A. $expand=DocumentLines (sans sous-select)", "Orders?$top=1&$select=DocEntry,DocNum&$expand=DocumentLines"],
  ["B. $expand=DocumentLines($select=LineNum)", "Orders?$top=1&$select=DocEntry,DocNum&$expand=DocumentLines($select=LineNum)"],
  ["C. $expand sans $select header", "Orders?$top=1&$expand=DocumentLines($select=LineNum,ItemCode)"],
  ["D. $expand=DocumentLines seul (pas de header select)", "Orders?$top=1&$expand=DocumentLines"],
  ["E. $select avec DocumentLines, SANS $expand", "Orders?$top=1&$select=DocEntry,DocNum,DocumentLines"],
];

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: COMPANY, UserName: get("SAP_B1_USERNAME"), Password: get("SAP_B1_PASSWORD") } });
  if (login.status !== 200) { console.error("LOGIN KO", login.status, JSON.stringify(login.body).slice(0, 200)); return; }
  const set = login.headers["set-cookie"];
  const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login OK\n");
  for (const [label, q] of VARIANTS) {
    const r = await req(q, { cookie });
    const ok = r.status < 400;
    const lines = ok && r.body.value?.[0]?.DocumentLines ? r.body.value[0].DocumentLines.length : "—";
    console.log(`${ok ? "✅" : "❌"} ${label} → ${r.status}` + (ok ? `  (lignes ramenées: ${lines})` : `  ${JSON.stringify(r.body?.error?.message?.value ?? r.body).slice(0, 120)}`));
  }
  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
