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

// 1. Groupes articles (id → nom) — pour mapper vers les catégories U_MB_*
console.log("=== ItemGroups (id → nom) ===");
const ig = await req("GET", "ItemGroups?$select=Number,GroupName&$top=200", { cookies });
for (const g of (ig.body?.value || [])) console.log(`  ${g.Number} → ${g.GroupName}`);

// 2. Un groupe article a-t-il un champ U_ "catégorie/famille" ?
console.log("\n=== ItemGroups(101) full (champs U_*) ===");
const g101 = await req("GET", "ItemGroups(101)", { cookies });
if (g101.status === 200) {
  const us = Object.entries(g101.body).filter(([k]) => k.startsWith("U_"));
  console.log(us.length ? us.map(([k,v])=>`${k}=${v}`).join(", ") : "(aucun U_* sur ItemGroups)");
}

// 3. L'article a-t-il un champ catégorie ? FE1SL full U_*
console.log("\n=== FE1SL U_* (catégorie/famille ?) ===");
const it = await req("GET", "Items('FE1SL')", { cookies });
const us = Object.entries(it.body).filter(([k,v]) => k.startsWith("U_"));
console.log(us.map(([k,v])=>`${k}=${JSON.stringify(v)}`).join(", "));

// 4. Prix d'achat : d'où vient le 0.9 ? Toutes les ItemPrices d'un item du site
console.log("\n=== ItemPrices 02FRL1629 (item présent dans la vue, achat=0.9) ===");
const it2 = await req("GET", "Items('02FRL1629')?$select=ItemCode,ItemsGroupCode,ItemPrices", { cookies });
console.log("groupe:", it2.body?.ItemsGroupCode);
for (const p of (it2.body?.ItemPrices || [])) if (p.Price) console.log(`  PriceList ${p.PriceList}: ${p.Price} ${p.Currency}`);

// 5. BusinessPartnerGroups 100 : tous les coefs
console.log("\n=== BPGroup 100 coefficients ===");
const bg = await req("GET", "BusinessPartnerGroups(100)", { cookies });
const coefs = Object.entries(bg.body).filter(([k]) => /U_MB_|U_Limite|U_Plafond/.test(k));
console.log(coefs.map(([k,v])=>`${k}=${v}`).join(", "));

await req("POST", "Logout", { cookies });
