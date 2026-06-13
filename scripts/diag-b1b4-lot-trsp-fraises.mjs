/**
 * Diag LECTURE SEULE (B1-B4) :
 *   [A] BL 24011560 — lignes + U_NoLot + commande de base (pourquoi lot vide ?)
 *   [B] U_TrspCode lisible sur Orders ? valeurs réelles pour 2-3 clients (12 mois)
 *   [C] Conditionnement fraises : SalesItemsPerUnit × SalesQtyPerPackUnit
 * Aucune écriture SAP (GET + Login/Logout uniquement).
 *   Usage: node scripts/diag-b1b4-lot-trsp-fraises.mjs
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const env = {};
for (const file of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), file);
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
const BASE = get("SAP_B1_BASE_URL");
const COMPANY = get("SAP_B1_COMPANY_DB");
const agent = new https.Agent({ rejectUnauthorized: get("SAP_B1_TLS_INSECURE") !== "1", keepAlive: true });

function req(pathname, { method = "GET", body, cookie } = {}) {
  const url = new URL(pathname.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((resolve, reject) => {
    const r = https.request(
      { hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method, agent,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => {
        let b = d; try { b = JSON.parse(d); } catch {} resolve({ status: res.statusCode, body: b, headers: res.headers }); }); });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: COMPANY, UserName: get("SAP_B1_USERNAME"), Password: get("SAP_B1_PASSWORD") } });
  if (login.status !== 200) { console.error("LOGIN KO", login.status, JSON.stringify(login.body).slice(0, 200)); return; }
  const set = login.headers["set-cookie"];
  const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login OK —", COMPANY);

  // ── [A] BL 24011560 ────────────────────────────────────────
  console.log("\n=== [A] BL 24011560 ===");
  const bl = await req(`DeliveryNotes?$filter=DocNum eq 24011560&$select=DocEntry,DocNum,DocDate,CardCode,Comments,U_TrspCode,DocumentLines`, { cookie });
  const d = bl.body?.value?.[0];
  if (!d) { console.log("BL introuvable (status", bl.status, ")"); }
  else {
    console.log(`DocEntry=${d.DocEntry} Card=${d.CardCode} Date=${(d.DocDate||"").slice(0,10)} U_TrspCode=${JSON.stringify(d.U_TrspCode)}`);
    console.log("Comments:", (d.Comments || "").slice(0, 120));
    const baseEntries = new Set();
    for (const l of (d.DocumentLines || [])) {
      console.log(`  L${l.LineNum} ${l.ItemCode} qty=${l.Quantity} whs=${l.WarehouseCode} U_NoLot=${JSON.stringify(l.U_NoLot)} BaseType=${l.BaseType} BaseEntry=${l.BaseEntry}`);
      if (l.BaseType === 17 && l.BaseEntry != null) baseEntries.add(l.BaseEntry);
    }
    for (const be of baseEntries) {
      const o = await req(`Orders(${be})`, { cookie });
      const ord = o.body;
      console.log(`  → Commande de base DocEntry=${be} DocNum=${ord.DocNum} U_TrspCode=${JSON.stringify(ord.U_TrspCode)} CreationDate=${ord.CreationDate} Comments="${(ord.Comments||"").slice(0,100)}"`);
      for (const l of (ord.DocumentLines || [])) {
        console.log(`     L${l.LineNum} ${l.ItemCode} qty=${l.Quantity} whs=${l.WarehouseCode} U_NoLot=${JSON.stringify(l.U_NoLot)}`);
      }
    }
  }

  // ── [B] U_TrspCode sur Orders, par client ──────────────────
  console.log("\n=== [B] U_TrspCode — Orders 12 mois ===");
  // Retrouve les CardCodes de NOYON / AFON via CardName
  for (const name of ["NOYON", "AFON"]) {
    const r = await req(`BusinessPartners?$filter=contains(CardName,'${name}')&$select=CardCode,CardName&$top=5`, { cookie });
    console.log(`BP "${name}":`, r.status, (r.body?.value || []).map((b) => `${b.CardCode}(${b.CardName})`).join(", ") || "(aucun)");
  }
  const since = new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10);
  const testCards = (process.argv[2] || "").split(",").filter(Boolean);
  // Si pas d'arg : prend les CardCodes trouvés ci-dessus en relançant la recherche
  const cards = [];
  for (const name of ["NOYON", "AFON"]) {
    const r = await req(`BusinessPartners?$filter=contains(CardName,'${name}')&$select=CardCode&$top=2`, { cookie });
    for (const b of (r.body?.value || [])) cards.push(b.CardCode);
  }
  for (const c of [...testCards, ...cards]) {
    const esc = c.replace(/'/g, "''");
    const r = await req(`Orders?$select=DocEntry,DocNum,DocDate,U_TrspCode&$filter=CardCode eq '${esc}' and DocDate ge '${since}'&$top=500&$orderby=DocEntry desc`, { cookie });
    if (r.status >= 400) { console.log(`${c}: ERREUR ${r.status}`, JSON.stringify(r.body?.error?.message).slice(0, 150)); continue; }
    const counts = {};
    for (const o of (r.body?.value || [])) {
      const k = (o.U_TrspCode ?? "(null)") || "(vide)";
      counts[k] = (counts[k] || 0) + 1;
    }
    console.log(`${c}: ${r.body?.value?.length ?? 0} cdes →`, JSON.stringify(counts));
  }

  // ── [C] Fraises — conditionnement ──────────────────────────
  console.log("\n=== [C] Fraises — NumInSale × SalPackUn ===");
  const SEL = "$select=ItemCode,ItemName,SalesUnit,SalesItemsPerUnit,SalesQtyPerPackUnit,SalesUnitWeight,InventoryUOM,U_GER_Det_Condt";
  for (const code of ["FB4KA3", "FB4FA2H"]) {
    const r = await req(`Items('${encodeURIComponent(code)}')?${SEL}`, { cookie });
    console.log(code, "→", r.status, JSON.stringify(r.body && r.status < 400 ? r.body : r.body?.error?.message).slice(0, 300));
  }
  const fr = await req(`Items?$filter=contains(ItemName,'FRAISE') and contains(U_GER_Det_Condt,'1KG')&${SEL}&$top=20`, { cookie });
  if (fr.status >= 400) {
    console.log("Recherche 1KG KO:", fr.status, JSON.stringify(fr.body?.error?.message).slice(0, 200));
    // fallback : toutes les fraises, filtre côté client
    const all = await req(`Items?$filter=contains(ItemName,'FRAISE')&${SEL}&$top=200`, { cookie });
    const v = (all.body?.value || []).filter((i) => /1\s*KG/i.test(i.U_GER_Det_Condt || ""));
    for (const i of v) console.log(" ", JSON.stringify(i));
  } else {
    for (const i of (fr.body?.value || [])) console.log(" ", JSON.stringify(i));
  }
  // 8x500g aussi (cas test demandé)
  const fr2 = await req(`Items?$filter=contains(ItemName,'FRAISE') and contains(U_GER_Det_Condt,'500')&${SEL}&$top=10`, { cookie });
  console.log("— 500g —");
  for (const i of (fr2.body?.value || [])) console.log(" ", JSON.stringify(i));

  await req("Logout", { method: "POST", cookie });
  console.log("\nLogout OK");
}
main().catch((e) => console.error("ERR", e.message));
