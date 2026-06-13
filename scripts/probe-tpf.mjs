/** Trouve où sont TPF2/TPF3 sur l'order #24011199 — dump TOUT. */
import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$"); process.env[m[1]] = v; }
  }
}
loadEnv(".env.local");
function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    const t = new URL(path, process.env.SAP_B1_BASE_URL + "/");
    const r = https.request({ hostname: t.hostname, port: t.port || 443, path: t.pathname + t.search, method,
      rejectUnauthorized: false, headers: { "Content-Type": "application/json", ...(opts.cookies ? { Cookie: opts.cookies } : {}) } },
      (resp) => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { let p = d; try { p = JSON.parse(d); } catch {}; res({ status: resp.statusCode, body: p, headers: resp.headers }); }); });
    r.on("error", rej); if (opts.body) r.write(JSON.stringify(opts.body)); r.end();
  });
}
const login = await req("POST", "Login", { body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD } });
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

const r = await req("GET", `Orders(128622)`, { cookies });
const o = r.body;

// Chercher TPF/ITFL/DDG dans TOUTE la structure (doc, lines, sub-objects)
function walk(obj, path = "") {
  if (obj === null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/tpf|itfl|ddg|interfel|ctifl|paraf|withhold|cotis|cvo/i.test(k)) {
      console.log(`  ★ ${p} = ${JSON.stringify(v).slice(0, 200)}`);
    }
    if (typeof v === "object") {
      if (Array.isArray(v)) v.forEach((it, i) => walk(it, `${p}[${i}]`));
      else walk(v, p);
    }
  }
}
console.log("=== Recherche TPF/ITFL/DDG/CVO partout dans l'order ===");
walk(o);

// === Print TOUTES les clés de chaque ligne pour repérer TPF2/TPF3 ===
console.log("\n=== TOUTES les clés ligne 0 ===");
const l = o.DocumentLines?.[0];
if (l) {
  console.log(Object.keys(l).sort().join(", "));
}

console.log("\n=== TOUTES les clés doc ===");
console.log(Object.keys(o).sort().join(", "));

// Check WithholdingTaxLines
console.log("\n=== WithholdingTaxDataCollection ===");
console.log(JSON.stringify(o.WithholdingTaxDataCollection, null, 2)?.slice(0, 600));

// Check sub-objects on lines
console.log("\n=== ligne 0 - sub arrays/objects ===");
if (l) {
  for (const [k, v] of Object.entries(l)) {
    if (Array.isArray(v) && v.length > 0) {
      console.log(`  ${k}: ${v.length} items, sample keys: ${Object.keys(v[0]).slice(0, 15).join(", ")}`);
    }
  }
}

await req("POST", "Logout", { cookies });
