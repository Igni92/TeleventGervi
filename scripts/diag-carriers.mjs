/**
 * Diag C11/B2/B3 — transporteurs (LECTURE SEULE, base PROD).
 *
 *   node scripts/diag-carriers.mjs [CARDCODE...]
 *
 * 1. Vérifie que U_TrspCode est $select-able sur Orders (filtré CardCode + DocDate).
 * 2. Inspecte BusinessPartners('APLAI') : existe-t-il un champ transporteur attitré
 *    (U_GER_TRSPS « tournée simplifiée », etc.) ?
 * 3. Histogramme U_TrspCode sur 24 mois pour quelques clients (Noyon, Afon…).
 * 4. Vérité terrain BL 24011560 : U_NoLot / U_TrspCode réellement posés.
 *
 * Plumbing identique à scripts/diag-fields.mjs (parsing .env + déséchappement \$).
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\\$/g, "$");
  }
}
const g = (k) => process.env[k] ?? env[k] ?? "";
const BASE = g("SAP_B1_BASE_URL");
const agent = new https.Agent({ rejectUnauthorized: g("SAP_B1_TLS_INSECURE") !== "1", keepAlive: true });
function req(p, { method = "GET", body, cookie } = {}) {
  const u = new URL(p.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  // ⚠️ Prefer odata.maxpagesize : sans lui, le Service Layer plafonne toute
  // réponse à PageSize=20 (b1s.conf), même avec $top=200.
  return new Promise((res, rej) => { const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, agent, headers: { "Content-Type": "application/json", Accept: "application/json", Prefer: "odata.maxpagesize=200", ...(cookie ? { Cookie: cookie } : {}) } }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, headers: x.headers, body: b }); }); }); r.on("error", rej); if (body) r.write(JSON.stringify(body)); r.end(); });
}

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  const set = login.headers["set-cookie"]; const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login", login.status, "—", g("SAP_B1_COMPANY_DB"));

  // ── 1. U_TrspCode sélectionnable sur Orders ? ──────────────
  const sel = await req(
    `Orders?$select=DocEntry,DocDate,U_TrspCode&$filter=${encodeURIComponent("CardCode eq 'APLAI' and DocDate ge '2025-06-11'")}&$top=20`,
    { cookie },
  );
  console.log("\n=== 1. Orders $select U_TrspCode (APLAI, depuis 2025-06-11) — HTTP", sel.status, "===");
  if (sel.status === 200) {
    for (const d of (sel.body.value || []).slice(0, 10)) {
      console.log(`  DocEntry ${d.DocEntry}  ${d.DocDate}  U_TrspCode=${JSON.stringify(d.U_TrspCode)}`);
    }
    console.log(`  (${(sel.body.value || []).length} docs)`);
  } else {
    console.log("  ERREUR:", JSON.stringify(sel.body).slice(0, 300));
  }

  // ── 2. BusinessPartner : champ transporteur attitré ? ─────
  const bp = await req(`BusinessPartners('APLAI')`, { cookie });
  console.log("\n=== 2. BusinessPartners('APLAI') — HTTP", bp.status, "===");
  if (bp.status === 200) {
    const keys = Object.keys(bp.body).filter((k) => /trsp|transp|tourn|carrier|ship/i.test(k));
    console.log("  Champs transporteur-like:", keys);
    for (const k of keys) console.log(`    ${k} = ${JSON.stringify(bp.body[k])}`);
    const uKeys = Object.keys(bp.body).filter((k) => k.startsWith("U_"));
    console.log("  Tous les U_* du BP:");
    for (const k of uKeys) console.log(`    ${k} = ${JSON.stringify(bp.body[k])}`);
  }

  // ── 3. Histogramme U_TrspCode sur 24 mois pour des clients tests ──
  const since = new Date(); since.setMonth(since.getMonth() - 24);
  const sinceStr = since.toISOString().slice(0, 10);
  const cards = process.argv.slice(2).length ? process.argv.slice(2) : ["APLAI"];
  // + recherche des CardCodes Noyon / Afon
  const search = await req(
    `BusinessPartners?$select=CardCode,CardName&$filter=${encodeURIComponent("contains(CardName,'NOYON') or contains(CardName,'AFON') or contains(CardName,'Noyon') or contains(CardName,'Afon')")}&$top=10`,
    { cookie },
  );
  console.log("\n=== 3a. BP candidats Noyon/Afon — HTTP", search.status, "===");
  for (const b of (search.body.value || [])) {
    console.log(`  ${b.CardCode}  ${b.CardName}`);
    if (!cards.includes(b.CardCode)) cards.push(b.CardCode);
  }
  console.log(`\n=== 3b. Histogramme U_TrspCode depuis ${sinceStr} ===`);
  for (const card of cards) {
    const counts = new Map();
    let skip = 0, total = 0;
    for (;;) {
      const r = await req(
        `Orders?$select=DocEntry,U_TrspCode&$filter=${encodeURIComponent(`CardCode eq '${card}' and DocDate ge '${sinceStr}'`)}&$top=200&$skip=${skip}`,
        { cookie },
      );
      if (r.status !== 200) { console.log(`  ${card}: ERREUR HTTP ${r.status}`, JSON.stringify(r.body).slice(0, 200)); break; }
      const docs = r.body.value || [];
      for (const d of docs) {
        total++;
        const code = (d.U_TrspCode ?? "").toString().trim() || "(vide)";
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      if (docs.length < 200) break;
      skip += docs.length;
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  ${card} — ${total} commandes : ${sorted.map(([c, n]) => `${c}×${n}`).join("  ") || "(aucune)"}`);
  }

  // ── 4. Vérité terrain BL 24011560 (bug lot/transporteur) ──
  const bl = await req(
    `Orders?$filter=${encodeURIComponent("DocNum eq 24011560")}&$select=DocEntry,DocNum,DocDate,CreationDate,UpdateDate,CardCode,Comments,U_TrspCode,DocumentLines`,
    { cookie },
  );
  console.log("\n=== 4. BL 24011560 — HTTP", bl.status, "===");
  const doc = bl.body.value?.[0];
  if (doc) {
    console.log(`  DocEntry ${doc.DocEntry}  DocDate ${doc.DocDate}  Création ${doc.CreationDate}  MAJ ${doc.UpdateDate}  CardCode ${doc.CardCode}`);
    console.log(`  U_TrspCode = ${JSON.stringify(doc.U_TrspCode)}`);
    console.log(`  Comments   = ${JSON.stringify(doc.Comments)}`);
    for (const l of (doc.DocumentLines || [])) {
      console.log(`  L${l.LineNum}  ${String(l.ItemCode).padEnd(12)} qty=${String(l.Quantity).padEnd(6)} whs=${l.WarehouseCode}  U_NoLot=${JSON.stringify(l.U_NoLot)}  ${l.ItemDescription ?? ""}`);
    }
  } else {
    console.log("  Introuvable :", JSON.stringify(bl.body).slice(0, 300));
  }

  // ── 5. Sonde cause racine B1 — PDN du lot EM22948 (la fraise du BL) ──
  const pdn = await req(
    `PurchaseDeliveryNotes?$filter=${encodeURIComponent("DocNum eq 22948")}&$select=DocEntry,DocNum,DocDate,CreationDate,CardCode,DocumentLines`,
    { cookie },
  );
  console.log("\n=== 5. PDN 22948 (lot EM22948) — HTTP", pdn.status, "===");
  const p22948 = pdn.body.value?.[0];
  if (p22948) {
    console.log(`  DocDate ${p22948.DocDate}  Création ${p22948.CreationDate}  CardCode ${p22948.CardCode}`);
    for (const l of (p22948.DocumentLines || [])) {
      console.log(`  L${l.LineNum}  ${String(l.ItemCode).padEnd(12)} qty=${String(l.Quantity).padEnd(6)} whs=${l.WarehouseCode}  U_NoLot=${JSON.stringify(l.U_NoLot)}`);
    }
  } else {
    console.log("  Introuvable.");
  }

  // ── 6a. Le filtre lambda EXACT de la propagation rétro goods-receipts marche-t-il ? ──
  // (app/api/sap/goods-receipts/route.ts construit ce $filter pour retrouver les
  //  Orders ouverts du jour à patcher EM_PENDING → EM<DocNum>.)
  const today = new Date().toISOString().slice(0, 10);
  const lambda = await req(
    `Orders?$top=5&$orderby=DocEntry asc&$select=DocEntry,DocNum,DocDate,DocumentStatus,DocumentLines`
    + `&$filter=${encodeURIComponent(`DocDate eq '${today}' and DocumentStatus eq 'bost_Open' and (DocumentLines/any(l: l/ItemCode eq 'FB4KA2'))`)}`,
    { cookie },
  );
  console.log(`\n=== 6a. Filtre lambda goods-receipts (ItemCode, ${today}) — HTTP ${lambda.status} ===`);
  if (lambda.status !== 200) console.log("  ", JSON.stringify(lambda.body).slice(0, 300));
  else console.log(`  OK — ${(lambda.body.value || []).length} docs`);

  // ── 6b. Ampleur — scan client-side des lignes sans lot exploitable sur 7 jours ──
  const since7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  let skip6 = 0; const suspects = []; let scanned = 0;
  for (;;) {
    const r = await req(
      `Orders?$select=DocEntry,DocNum,DocDate,CardCode,DocumentLines&$filter=${encodeURIComponent(`DocDate ge '${since7}'`)}&$top=200&$skip=${skip6}`,
      { cookie },
    );
    if (r.status !== 200) { console.log("  ERREUR scan 6b:", JSON.stringify(r.body).slice(0, 200)); break; }
    const docs = r.body.value || [];
    for (const d of docs) {
      scanned++;
      const bad = (d.DocumentLines || []).filter((l) =>
        l.U_NoLot == null || l.U_NoLot === "" || l.U_NoLot === "EM_PENDING" || l.U_NoLot === "EM0000");
      if (bad.length > 0) suspects.push({ d, bad });
    }
    if (docs.length < 200) break;
    skip6 += docs.length;
  }
  console.log(`\n=== 6b. Lignes sans lot exploitable depuis ${since7} (${scanned} commandes scannées) ===`);
  for (const { d, bad } of suspects) {
    console.log(`  #${d.DocNum} ${d.DocDate} ${String(d.CardCode).padEnd(10)} → ${bad.map((l) => `${l.ItemCode}@${l.WarehouseCode}=${JSON.stringify(l.U_NoLot)}`).join(", ")}`);
  }
  if (suspects.length === 0) console.log("  (aucune)");

  // ── 7. Fallback possible pour les EM0000 : BatchNumberDetails (lots réels SAP) ──
  for (const code of ["K27", "CERISE", "FB4KA2", "FRAMB12PD"]) {
    const r = await req(
      `BatchNumberDetails?$select=ItemCode,Batch,SystemNumber,AdmissionDate&$filter=${encodeURIComponent(`ItemCode eq '${code}'`)}&$orderby=SystemNumber desc&$top=3`,
      { cookie },
    );
    console.log(`\n=== 7. BatchNumberDetails '${code}' — HTTP ${r.status} ===`);
    if (r.status !== 200) { console.log("  ", JSON.stringify(r.body).slice(0, 200)); continue; }
    for (const b of (r.body.value || [])) {
      console.log(`  Batch=${JSON.stringify(b.Batch)}  Sys#${b.SystemNumber}  admis ${b.AdmissionDate}`);
    }
    if ((r.body.value || []).length === 0) console.log("  (aucun lot)");
  }

  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
