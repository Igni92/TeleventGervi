/** Try a few common DB name variations to find the right one. */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv(".env.local");

const BASE = process.env.SAP_B1_BASE_URL;
const USER = process.env.SAP_B1_USERNAME;
const PASS = process.env.SAP_B1_PASSWORD;

function login(companyDb) {
  return new Promise((resolve) => {
    const target = new URL("Login", BASE.endsWith("/") ? BASE : BASE + "/");
    const opts = {
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: "POST",
      rejectUnauthorized: false,
      headers: { "Content-Type": "application/json" },
    };
    const req = https.request(opts, (res) => {
      let data = ""; res.on("data", (c) => data += c);
      res.on("end", () => {
        let parsed = data; try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", (e) => resolve({ error: e.message }));
    req.write(JSON.stringify({ CompanyDB: companyDb, UserName: USER, Password: PASS }));
    req.end();
  });
}

const variants = [
  "GERVIFRAIS SARL",
  "GERVIFRAIS",
  "GERVIFRAIS_SARL",
  "GERVIFRAIS-SARL",
  "Gervifrais SARL",
  "gervifrais",
  "GERVIFRAIS SAS",
  "SBO_GERVIFRAIS",
  "PROD_GERVIFRAIS",
  "TST_GERVIFRAIS",
  "DEV_GERVIFRAIS",
];

console.log("🔎 Test des variantes de DB name (auth GERJMG)…\n");

for (const db of variants) {
  const r = await login(db);
  if (r.status === 200) {
    console.log(`✅ TROUVÉ : "${db}"`);
    console.log(`   Version: ${r.body?.Version}, SessionId: ${r.body?.SessionId}`);
    process.exit(0);
  }
  const msg = r.body?.error?.message?.value || r.error || `HTTP ${r.status}`;
  const short = msg.length > 60 ? msg.slice(0, 60) + "…" : msg;
  console.log(`❌ "${db}" → ${short}`);
}

console.log("\n⚠️  Aucune variante n'a fonctionné. Il faut demander le nom exact à ton admin SAP.");
