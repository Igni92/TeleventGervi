/**
 * GROS SMOKE TEST — crée 55 commandes (BL) variées dans SAP TEST et vérifie
 * la conformité de chacune (lot EM, TPF2 INTERFEL, TPF3 DDG, prix, NumAtCard,
 * découpe multi-entrepôt). Réplique EXACTEMENT la logique de app/api/sap/orders.
 *
 * Cas couverts : 1-4 lignes, kg/pie/colis, multi-entrepôt, sur-vente,
 * lignes sans prix (tarif SAP), avec/sans NumAtCard, article sans réception (EM0000).
 */
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

// RNG déterministe (reproductible)
let seed = 1337;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const FILL = ["000", "01", "R1"];
const WHS_NAME = { "000": "A/C - A/D", "01": "Stock", "R1": "J+1" };

const login = await req("POST", "Login", { body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD } });
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
console.log("DB:", process.env.SAP_B1_COMPANY_DB);

// 1. Taux TPF
const ae = await req("GET", "AdditionalExpenses?$top=10", { cookies });
const taux = {};
for (const e of (ae.body?.value || [])) taux[e.ExpensCode] = e.U_Taux;
const ITFEL_TAUX = taux[2] ?? 0.21, DDG_TAUX = taux[3] ?? 0.02;
console.log(`Taux: INTERFEL=${ITFEL_TAUX}%  DDG=${DDG_TAUX}€/colis`);

// 2. Lot maps (item|whs -> EM docNum)
const byItemWhs = new Map(), byItem = new Map();
{ let skip = 0; while (skip < 500) {
  const r = await req("GET", `PurchaseDeliveryNotes?$top=50&$skip=${skip}&$orderby=DocNum desc&$select=DocNum,DocumentLines`, { cookies });
  const docs = r.body?.value || []; if (!docs.length) break;
  for (const d of docs) for (const l of (d.DocumentLines || [])) {
    if (!l.ItemCode) continue;
    if (!byItem.has(l.ItemCode) || d.DocNum > byItem.get(l.ItemCode)) byItem.set(l.ItemCode, d.DocNum);
    if (l.WarehouseCode) { const k = `${l.ItemCode}|${l.WarehouseCode}`; if (!byItemWhs.has(k) || d.DocNum > byItemWhs.get(k)) byItemWhs.set(k, d.DocNum); }
  }
  skip += docs.length;
} }
const resolveLot = (item, whs) => {
  if (whs && byItemWhs.has(`${item}|${whs}`)) return `EM${byItemWhs.get(`${item}|${whs}`)}`;
  if (byItem.has(item)) return `EM${byItem.get(item)}`;
  return "EM0000";
};
console.log(`Lots: ${byItem.size} articles avec réception, ${byItemWhs.size} couples item|entrepôt`);

// 3. Pool produits (stock SAP live)
const itemsResp = await req("GET",
  "Items?$filter=Valid eq 'tYES' and Frozen eq 'tNO' and QuantityOnStock gt 0"
  + "&$select=ItemCode,ItemName,SalesUnit,SalesPackagingUnit,SalesQtyPerPackUnit,SalesUnitWeight,QuantityOnStock,ItemWarehouseInfoCollection&$top=60", { cookies });
const pool = [];
for (const it of (itemsResp.body?.value || [])) {
  const packDiv = (it.SalesQtyPerPackUnit && it.SalesQtyPerPackUnit > 1) ? it.SalesQtyPerPackUnit : 1;
  const availByWhs = {};
  for (const w of FILL) {
    const wi = (it.ItemWarehouseInfoCollection || []).find(x => x.WarehouseCode === w);
    const avail = wi ? (wi.InStock - wi.Committed) : 0;
    availByWhs[w] = Math.max(0, Math.floor((avail / packDiv) * 10) / 10);
  }
  const totalAvail = FILL.reduce((s, w) => s + availByWhs[w], 0);
  pool.push({
    itemCode: it.ItemCode, packDiv, salesUnit: it.SalesUnit,
    weight: it.SalesUnitWeight ?? 0, availByWhs, totalAvail,
    hasLot: byItem.has(it.ItemCode),
  });
}
// On utilise tous les articles valides (QuantityOnStock>0). Si la dispo par entrepôt
// est nulle (déjà committée), la commande passe en sur-vente sur 000 — autorisé.
const withStock = pool.length >= 3 ? pool : [];
console.log(`Pool: ${pool.length} articles valides (${pool.filter(p=>p.totalAvail>0).length} avec dispo>0)`);
if (withStock.length < 3) { console.error("Pas assez d'articles pour le test."); await req("POST","Logout",{cookies}); process.exit(1); }

const splitByWhs = (qtyDisplay, availByWhs) => {
  let rem = qtyDisplay; const chunks = [];
  for (const w of FILL) { if (rem <= 0.0001) break; const a = Math.max(0, availByWhs[w] ?? 0); if (a <= 0) continue;
    const take = Math.min(a, rem); chunks.push({ w, qty: Math.round(take * 1000) / 1000 }); rem -= take; }
  if (rem > 0.0001) { const w = FILL.find(x => (availByWhs[x] ?? 0) > 0) ?? "000";
    const ex = chunks.find(c => c.w === w); if (ex) ex.qty = Math.round((ex.qty + rem) * 1000) / 1000; else chunks.push({ w, qty: Math.round(rem * 1000) / 1000 }); }
  return chunks;
};
const CARDS = ["AAUXERRE", "APLAI"];
const r2 = (n) => Math.round(n * 100) / 100;

// 4. Génère et crée 55 commandes
const N = 55;
const results = [];
for (let i = 0; i < N; i++) {
  const nLines = randInt(1, 4);
  const card = pick(CARDS);
  const usedItems = new Set();
  const logicalLines = [];
  for (let j = 0; j < nLines; j++) {
    const prod = pick(withStock);
    if (usedItems.has(prod.itemCode)) continue;
    usedItems.add(prod.itemCode);
    // scénarios qté : cap basé sur la dispo si >0, sinon plage par défaut 1..15
    const cap = Math.max(5, Math.floor(prod.totalAvail) || 0);
    const mode = rnd();
    let displayQty;
    if (mode < 0.2) displayQty = r2((prod.totalAvail || 10) * 1.5 + 1);   // sur-vente
    else if (mode < 0.4) displayQty = Math.max(1, Math.floor(prod.totalAvail) || randInt(1, 15));
    else displayQty = randInt(1, cap);
    const withPrice = rnd() > 0.25;                                   // 75% avec prix
    const price = withPrice ? r2(0.2 + rnd() * 5) : null;
    logicalLines.push({ prod, displayQty, price });
  }
  if (logicalLines.length === 0) { i--; continue; }
  const numAtCard = rnd() > 0.5 ? `SMOKE-${1000 + i}` : "";

  // Construit le payload (réplique route)
  const docLines = [];
  const expected = [];   // pour vérif
  for (const ll of logicalLines) {
    const chunks = splitByWhs(ll.displayQty, ll.prod.availByWhs);
    for (const c of chunks) {
      const invQty = r2(c.qty * ll.prod.packDiv);
      const lineHT = ll.price ? r2(ll.price * invQty) : 0;
      const nbColis = invQty / ll.prod.packDiv;
      const itfel = (ll.price ? r2(lineHT * (ITFEL_TAUX / 100)) : 0);
      const ddg = r2(nbColis * DDG_TAUX);
      const lot = resolveLot(ll.prod.itemCode, c.w);
      const lineExp = [];
      if (itfel > 0) lineExp.push({ GroupCode: 1, ExpenseCode: 2, LineTotal: itfel });
      if (ddg > 0) lineExp.push({ GroupCode: 2, ExpenseCode: 3, LineTotal: ddg });
      const dl = { ItemCode: ll.prod.itemCode, Quantity: invQty, WarehouseCode: c.w,
        U_NoLot: lot, U_NomMag: WHS_NAME[c.w] };
      if (ll.price) { dl.UnitPrice = ll.price; dl.Price = ll.price; }
      if (lineExp.length) dl.DocumentLineAdditionalExpenses = lineExp;
      docLines.push(dl);
      expected.push({ itemCode: ll.prod.itemCode, whs: c.w, invQty, price: ll.price, lot, itfel, ddg, nbColis });
    }
  }
  const payload = { CardCode: card, DocDueDate: "2026-06-05",
    Comments: `SMOKE TeleVent #${i}`, DocumentLines: docLines };
  if (numAtCard) payload.NumAtCard = numAtCard;

  const cr = await req("POST", "Orders", { cookies, body: payload });
  if (cr.status < 200 || cr.status >= 300) {
    results.push({ i, ok: false, exception: `POST ${cr.status}: ${cr.body?.error?.message?.value || JSON.stringify(cr.body).slice(0,200)}`, payload });
    continue;
  }
  // Refetch
  let o = (await req("GET", `Orders(${cr.body.DocEntry})`, { cookies })).body;

  // === RÉCONCILIATION TPF (réplique route) : recalcule depuis LineTotal réel + PATCH ===
  {
    const patchLines = [];
    for (const l of (o.DocumentLines || [])) {
      // packDiv : on le retrouve via le pool
      const prod = withStock.find(p => p.itemCode === l.ItemCode) || pool.find(p => p.itemCode === l.ItemCode);
      const packDiv = prod?.packDiv ?? 1;
      const lineHT = l.LineTotal ?? 0;
      const nbColis = (l.Quantity ?? 0) / packDiv;
      const expItfel = r2(lineHT * (ITFEL_TAUX / 100));
      const expDdg = r2(nbColis * DDG_TAUX);
      const exps = l.DocumentLineAdditionalExpenses || [];
      const curItfel = exps.find(e => e.ExpenseCode === 2)?.LineTotal ?? 0;
      const curDdg = exps.find(e => e.ExpenseCode === 3)?.LineTotal ?? 0;
      if (Math.abs(expItfel - curItfel) > 0.005 || Math.abs(expDdg - curDdg) > 0.005) {
        const merged = [];
        if (expItfel > 0) merged.push({ GroupCode: 1, ExpenseCode: 2, LineTotal: expItfel });
        if (expDdg > 0) merged.push({ GroupCode: 2, ExpenseCode: 3, LineTotal: expDdg });
        patchLines.push({ LineNum: l.LineNum, DocumentLineAdditionalExpenses: merged });
      }
    }
    if (patchLines.length > 0) {
      await req("PATCH", `Orders(${cr.body.DocEntry})`, { cookies, body: { DocumentLines: patchLines } });
      o = (await req("GET", `Orders(${cr.body.DocEntry})`, { cookies })).body;
    }
  }
  // vérifie
  const issues = [];
  // NumAtCard
  if ((o.NumAtCard || "") !== numAtCard) issues.push(`NumAtCard "${o.NumAtCard}" ≠ "${numAtCard}"`);
  // lignes
  if ((o.DocumentLines || []).length !== expected.length)
    issues.push(`#lignes ${o.DocumentLines?.length} ≠ attendu ${expected.length}`);
  o.DocumentLines?.forEach((dl, k) => {
    const ex = expected[k];
    if (!ex) return;
    if (!dl.U_NoLot) issues.push(`L${k} U_NoLot vide`);
    else if (dl.U_NoLot !== ex.lot) issues.push(`L${k} lot ${dl.U_NoLot}≠${ex.lot}`);
    if (dl.WarehouseCode !== ex.whs) issues.push(`L${k} whs ${dl.WarehouseCode}≠${ex.whs}`);
    // TPF attendus calculés depuis le LineTotal RÉEL (post-réconciliation) :
    const prod = withStock.find(p => p.itemCode === dl.ItemCode) || pool.find(p => p.itemCode === dl.ItemCode);
    const packDiv = prod?.packDiv ?? 1;
    const expItfel = r2((dl.LineTotal ?? 0) * (ITFEL_TAUX / 100));
    const expDdg = r2(((dl.Quantity ?? 0) / packDiv) * DDG_TAUX);
    const exps = dl.DocumentLineAdditionalExpenses || [];
    const tpf2 = exps.find(e => e.ExpenseCode === 2)?.LineTotal ?? null;
    const tpf3 = exps.find(e => e.ExpenseCode === 3)?.LineTotal ?? null;
    if (expItfel > 0) {
      if (tpf2 === null) issues.push(`⚑ L${k} INTERFEL manquant (HT=${dl.LineTotal}€, attendu ${expItfel}€)`);
      else if (Math.abs(tpf2 - expItfel) > 0.011) issues.push(`L${k} TPF2 ${tpf2}≠${expItfel}`);
    }
    if (expDdg > 0) {
      if (tpf3 === null) issues.push(`L${k} TPF3 manquant (attendu ${expDdg}€)`);
      else if (Math.abs(tpf3 - expDdg) > 0.011) issues.push(`L${k} TPF3 ${tpf3}≠${expDdg}`);
    }
  });
  results.push({ i, ok: issues.length === 0, docNum: o.DocNum, docEntry: o.DocEntry,
    nLines: expected.length, total: o.DocTotal, numAtCard, issues });
}

// 5. Rapport
await req("POST", "Logout", { cookies });
const created = results.filter(r => r.docNum);
const conform = results.filter(r => r.ok);
const exceptions = results.filter(r => !r.ok);
console.log(`\n${"=".repeat(70)}\nRÉSULTAT : ${results.length} commandes tentées`);
console.log(`  ✅ créées: ${created.length}   conformes: ${conform.length}   avec souci: ${exceptions.length}`);
console.log(`  ❌ échecs création (exceptions SAP): ${results.filter(r=>r.exception).length}`);
console.log("=".repeat(70));
// Détail des soucis
const tpfMissing = [];
for (const r of exceptions) {
  if (r.exception) { console.log(`\n[#${r.i}] ❌ EXCEPTION CRÉATION: ${r.exception}`); continue; }
  console.log(`\n[#${r.i}] BL #${r.docNum} (${r.nLines} l, ${r.total}€) — soucis:`);
  for (const is of r.issues) { console.log(`    - ${is}`); if (is.includes("INTERFEL NON calculé")) tpfMissing.push(r.docNum); }
}
console.log(`\n${"=".repeat(70)}\nSYNTHÈSE EXCEPTIONS`);
console.log(`  • BL avec INTERFEL non calculé (lignes sans prix saisi): ${tpfMissing.length}`);
console.log(`  • Échecs SAP: ${results.filter(r=>r.exception).length}`);
console.log(`  • Autres non-conformités: ${exceptions.filter(r=>!r.exception && !r.issues.some(x=>x.includes("INTERFEL NON"))).length}`);
console.log(`\nDocNums créés: ${created.map(r=>r.docNum).join(", ")}`);
