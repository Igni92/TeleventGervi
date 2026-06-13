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
if (login.status !== 200) { console.log("LOGIN FAIL", login.status, "— sessions saturées"); process.exit(0); }

// Groupes article : fraise=101, échalotte=113 ; dump complet pour trouver le champ catégorie
for (const code of [101, 113, 127, 110]) {
  const g = await req("GET", `ItemGroups(${code})`, { cookies });
  if (g.status !== 200) { console.log(`ItemGroups(${code}) → ${g.status}`); continue; }
  const nn = Object.entries(g.body).filter(([k, v]) => v !== null && v !== "" && !k.startsWith("odata"));
  console.log(`\n=== ItemGroups ${code} : ${g.body.GroupName} ===`);
  console.log(nn.map(([k, v]) => `${k}=${v}`).join(", "));
}

// UDT de mapping catégorie ?
console.log("\n=== UDT (famille/categ/MB/marge) ===");
let skip = 0; const tables = [];
while (skip < 400) {
  const r = await req("GET", `UserTablesMD?$top=100&$skip=${skip}&$select=TableName,TableDescription`, { cookies });
  const its = r.body?.value || []; if (!its.length) break; tables.push(...its); skip += its.length;
}
for (const t of tables) if (/fam|categ|mb|marge|famille|rges|fraise|legume/i.test(t.TableName + " " + t.TableDescription)) console.log(`  @${t.TableName} — ${t.TableDescription}`);

await req("POST", "Logout", { cookies });
