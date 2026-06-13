/** Dump TOUS les U_* d'un article + d'une ligne d'order — pour trouver Pays/Marque/Variété. */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$");
      process.env[m[1]] = v;
    }
  }
}
loadEnv(".env.local");

const BASE = process.env.SAP_B1_BASE_URL;
function req(method, path, { cookies = "", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, BASE + "/");
    const r = https.request({
      hostname: target.hostname, port: target.port || 443,
      path: target.pathname + target.search, method,
      rejectUnauthorized: false,
      headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
    }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => {
        let p = d; try { p = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: p });
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const login = await req("POST", "Login", {
  body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD },
});
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// 1. ALL U_* on Item FRAMB12PD (including nulls)
console.log("== Item FRAMB12PD — ALL U_* fields (null included) ==");
const it = await req("GET", "Items('FRAMB12PD')", { cookies });
if (it.status === 200) {
  Object.entries(it.body).filter(([k]) => k.startsWith("U_")).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(35)} : ${JSON.stringify(v)}`);
  });
}

// 2. Find an order with U_GER_Pays filled (= maybe manually created)
console.log("\n== Cherche un order où U_GER_Pays est rempli ==");
const orders = await req("GET",
  "Orders?$top=50&$orderby=DocEntry desc&$select=DocEntry,DocNum,DocumentLines",
  { cookies });
let found = false;
for (const o of (orders.body?.value || [])) {
  for (const l of (o.DocumentLines || [])) {
    if (l.U_GER_Pays || l.U_GER_Marque || l.U_GER_Variete || l.U_Origine) {
      console.log(`Order #${o.DocNum} ligne ${l.ItemCode} :`);
      Object.entries(l).filter(([k, v]) => k.startsWith("U_") && v !== null && v !== "" && v !== 0).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(28)} : ${JSON.stringify(v)}`);
      });
      found = true;
      break;
    }
  }
  if (found) break;
}
if (!found) console.log("Aucun order n'a U_GER_Pays/Marque rempli. Champs vides en SAP UI aussi ?");

// 3. Try Item attribute keywords to find Pays/Marque/Variete somewhere on Items
console.log("\n== Recherche d'attributs Pays/Marque/Variété ==");
const it2 = await req("GET", "Items('FRAMB12PD')", { cookies });
const allKeys = Object.keys(it2.body);
const matches = allKeys.filter(k => /pays|marque|variete|fruit|origin|brand/i.test(k));
console.log("Clés correspondantes:", matches);
matches.forEach(k => console.log(`  ${k} : ${JSON.stringify(it2.body[k])}`));

// 4. Try ItemProperties or ItemPropertiesCollection
console.log("\n== ItemProperties dispos ==");
const ip = await req("GET", "ItemProperties?$top=5", { cookies });
if (ip.status === 200 && ip.body.value?.[0]) {
  console.log("Top 5 properties:");
  ip.body.value.forEach(p => console.log(`  ${p.ItemPropertyName || JSON.stringify(p)}`));
}

await req("POST", "Logout", { cookies });
