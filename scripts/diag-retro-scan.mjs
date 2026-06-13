/**
 * Diag propagation rétro goods-receipts (LECTURE SEULE, base PROD).
 *
 *   node scripts/diag-retro-scan.mjs [YYYY-MM-DD]
 *
 * Valide le correctif de app/api/sap/goods-receipts/route.ts :
 *   1. Re-confirme que le filtre lambda `DocumentLines/any(...)` est rejeté
 *      en HTTP 400 par ce Service Layer (cause racine, sonde 6a diag-carriers).
 *   2. Exécute la NOUVELLE requête sans lambda (dates quotées, DocumentLines
 *      dans le $select, header Prefer: odata.maxpagesize=200, pagination $skip)
 *      et affiche ce que la propagation rétro patcherait : lignes U_NoLot
 *      = 'EM_PENDING' des commandes ouvertes du jour.
 *
 * Aucune écriture SAP : Login / GET / Logout uniquement.
 * Plumbing identique à scripts/diag-carriers.mjs (parsing .env + déséchappement \$).
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

const LOT_PENDING = "EM_PENDING";

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  const set = login.headers["set-cookie"]; const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login", login.status, "—", g("SAP_B1_COMPANY_DB"));
  if (login.status !== 200) { console.error("Login KO, abandon."); return; }

  const today = process.argv[2] || new Date().toISOString().slice(0, 10);

  // ── 1. Contrôle négatif : l'ancien filtre lambda doit toujours échouer ──
  const lambda = await req(
    `Orders?$top=5&$select=DocEntry&$filter=${encodeURIComponent(`DocDate eq '${today}' and DocumentStatus eq 'bost_Open' and (DocumentLines/any(l: l/ItemCode eq 'FB4KA2'))`)}`,
    { cookie },
  );
  console.log(`\n=== 1. Ancien filtre lambda — HTTP ${lambda.status} (attendu : 400) ===`);
  if (lambda.status !== 200) console.log("  ", JSON.stringify(lambda.body?.error?.message ?? lambda.body).slice(0, 200));
  else console.log("  ⚠️ Le lambda passe désormais ?! Re-vérifier la version du Service Layer.");

  // ── 2. Nouvelle requête (celle du correctif) : scan sans lambda + pagination ──
  const filter = encodeURIComponent(`DocDate eq '${today}' and DocumentStatus eq 'bost_Open'`);
  const basePath = `Orders?$orderby=DocEntry asc&$select=DocEntry,DocNum,DocDate,DocumentStatus,DocumentLines&$filter=${filter}`;
  let skip = 0; const orders = []; let pages = 0; let firstStatus = null;
  for (;;) {
    const r = await req(`${basePath}&$top=200&$skip=${skip}`, { cookie });
    if (firstStatus === null) firstStatus = r.status;
    if (r.status !== 200) { console.log(`\n  ERREUR scan HTTP ${r.status}:`, JSON.stringify(r.body).slice(0, 300)); break; }
    const docs = r.body.value || [];
    orders.push(...docs); pages++;
    if (docs.length < 200) break;
    skip += docs.length;
  }
  console.log(`\n=== 2. Nouveau scan sans lambda (${today}) — HTTP ${firstStatus} ===`);
  console.log(`  ${orders.length} commande(s) ouverte(s) en ${pages} page(s) de 200 max`);

  // ── 3. Simulation : lignes EM_PENDING que la propagation rétro patcherait ──
  let pendingLines = 0;
  for (const ord of orders) {
    const pending = (ord.DocumentLines || []).filter((l) => l.U_NoLot === LOT_PENDING);
    if (pending.length === 0) continue;
    pendingLines += pending.length;
    console.log(`  #${ord.DocNum} (DocEntry ${ord.DocEntry}) → ${pending.map((l) => `L${l.LineNum} ${l.ItemCode} qty=${l.Quantity}`).join(", ")}`);
  }
  console.log(`\n=== 3. Bilan : ${pendingLines} ligne(s) ${LOT_PENDING} patchable(s) sur ${orders.length} commande(s) du ${today} ===`);
  if (pendingLines === 0) console.log("  (aucune — normal si aucune vente à découvert aujourd'hui ; la requête, elle, est validée par le HTTP 200 ci-dessus)");

  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
