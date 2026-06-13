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
if (login.status !== 200) { console.log("LOGIN FAIL", login.status); process.exit(0); }

// 1. Entités "Group" dans metadata
const meta = await req("GET", "$metadata", { cookies });
const txt = typeof meta.body === "string" ? meta.body : JSON.stringify(meta.body);
const ents = [...new Set((txt.match(/EntityType Name="([^"]*[Gg]roup[^"]*)"/g) || []).map(s => s.replace(/.*Name="|"/g,"")))];
console.log("EntityTypes 'Group':", ents.slice(0,30).join(", "));
const sets = [...new Set((txt.match(/EntitySet Name="([^"]*[Gg]roup[^"]*)"/g) || []).map(s => s.replace(/.*Name="|"/g,"")))];
console.log("EntitySets 'Group':", sets.slice(0,30).join(", "));

// 2. Test entités groupes BP
for (const ep of ["BusinessPartnerGroups", "CustomerGroups", "BPGroups"]) {
  const r = await req("GET", `${ep}?$top=2`, { cookies });
  console.log(`\n${ep} → ${r.status}`);
  if (r.status === 200 && r.body?.value?.[0]) {
    console.log("  Keys:", Object.keys(r.body.value[0]).join(", "));
    console.log("  Sample:", JSON.stringify(r.body.value[0]).slice(0, 300));
  }
}

// 3. Prix d'achat + groupe article FE1SL
const it = await req("GET", "Items('FE1SL')?$select=ItemCode,ItemsGroupCode,ItemPrices", { cookies });
console.log("\nFE1SL groupe + ItemPrices:", JSON.stringify(it.body).slice(0, 500));

// 4. Revérifie formule sur la vue : Prix Achat × Coef = Prix vente ?
const v = await req("GET", `view.svc/GERVI_SITE_PVB1SLQuery?$filter=${encodeURIComponent("ItemCode eq '02FRL1629'")}&$top=3`, { cookies });
for (const r of (v.body?.value || [])) {
  console.log(`  grp ${r["Code Groupe Client"]}: achat=${r["Prix Achat"]} coef=${r.Coef} → ${(r["Prix Achat"]*r.Coef).toFixed(3)} vs PV=${r["Prix vente"]} | grpArt=${r.Groupe_Article}`);
}
await req("POST", "Logout", { cookies });
