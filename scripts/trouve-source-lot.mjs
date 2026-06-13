/** D'où vient EM22739 (lot de FE1SL) ? UDT, entrées marchandise, champs custom. */
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

// 1. Liste des UDT (tables custom)
console.log("=== UserTablesMD (tables custom) ===");
const ut = await req("GET", "UserTablesMD?$top=100&$select=TableName,TableDescription", { cookies });
for (const t of (ut.body?.value || [])) {
  const flag = /lot|stock|entree|em|march|trac/i.test(t.TableName + " " + t.TableDescription) ? " ★" : "";
  console.log(`  @${t.TableName} — ${t.TableDescription}${flag}`);
}

// 2. Entrée marchandise (PurchaseDeliveryNotes) récente pour FE1SL — chercher EM number / lot
console.log("\n=== PurchaseDeliveryNotes récentes avec FE1SL ===");
const pdn = await req("GET", "PurchaseDeliveryNotes?$top=10&$orderby=DocEntry desc&$filter=DocumentLines/any(l: l/ItemCode eq 'FE1SL')", { cookies });
console.log("Status", pdn.status, "count", pdn.body?.value?.length);
for (const d of (pdn.body?.value || []).slice(0, 3)) {
  console.log(`  PDN #${d.DocNum} DocEntry=${d.DocEntry} Date=${d.DocDate}`);
  // doc-level U_*
  const du = Object.entries(d).filter(([k,v]) => k.startsWith("U_") && v && v!=="" && /lot|em|march/i.test(k));
  du.forEach(([k,v]) => console.log(`    doc ${k}=${v}`));
  for (const l of (d.DocumentLines || []).filter(l => l.ItemCode === "FE1SL").slice(0,2)) {
    const lu = Object.entries(l).filter(([k,v]) => k.startsWith("U_") && v && v!=="");
    console.log(`    ligne FE1SL: ${lu.map(([k,v])=>`${k}=${v}`).join(", ") || "(aucun U_*)"}`);
  }
}

// 3. Chercher la valeur EM22739 dans les UDT probables
console.log("\n=== Recherche EM22739 dans UDT candidates ===");
for (const t of (ut.body?.value || [])) {
  if (!/lot|stock|em|march|trac|entree/i.test(t.TableName + t.TableDescription)) continue;
  const r = await req("GET", `${t.TableName}?$top=3`, { cookies });
  console.log(`  @${t.TableName} → ${r.status}`);
  if (r.status === 200 && r.body?.value?.[0]) {
    console.log(`    Keys: ${Object.keys(r.body.value[0]).join(", ")}`);
    console.log(`    Sample: ${JSON.stringify(r.body.value[0]).slice(0, 250)}`);
  }
}

// 4. Notre table ProductBatch DB — qu'a-t-on synchronisé pour FE1SL ?
console.log("\n=== (info) U_NoLot vient peut-être d'un champ Item custom ===");
const it = await req("GET", "Items('FE1SL')", { cookies });
if (it.status === 200) {
  const lotFields = Object.entries(it.body).filter(([k,v]) => /lot|em|march/i.test(k) && v && v !== "");
  lotFields.forEach(([k,v]) => console.log(`  Item.${k} = ${v}`));
  if (lotFields.length === 0) console.log("  Aucun champ lot/EM sur l'article FE1SL.");
}

await req("POST", "Logout", { cookies });
