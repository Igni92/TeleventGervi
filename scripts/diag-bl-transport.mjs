/**
 * Diag TRANSPORT / TOURNÉE / BL — LECTURE SEULE (base PROD).
 *
 *   node scripts/diag-bl-transport.mjs [DOCNUM...] [--card CARDCODE]
 *
 * Objectif : comprendre EXACTEMENT comment un BL « propre » est rempli côté
 * transport (U_TrspCode, U_TrspHeure, U_Timbre, …) et d'où viennent ces valeurs
 * dans SERG_TRCL (tournées du client, colonne Défaut U_TrspDef='O').
 *
 * Étapes :
 *   1. Connexion + dump de TOUS les champs U_* de quelques BL récents
 *      (ou des DocNum passés en argument) → on voit les valeurs réelles de
 *      U_TrspCode / U_TrspHeure / U_Timbre.
 *   2. Pour chaque client de ces BL : lecture SERG_TRCL (essais U_SERG_TRCL →
 *      SERG_TRCL → UDO → SQLQueries) et dump de TOUTES les colonnes de ses
 *      lignes (transporteur, tournée U_DistBy, heure U_Heure, défaut U_TrspDef…).
 *   3. Corrélation : pour chaque BL, on aligne U_TrspCode/U_TrspHeure/U_Timbre
 *      avec la ligne SERG_TRCL correspondante (et la ligne défaut) → on en
 *      déduit la règle de remplissage à reproduire dans l'app.
 *
 * Aucune écriture. Sortie verbeuse à copier/coller.
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
if (!BASE) { console.error("❌ SAP_B1_BASE_URL absent (.env / env). Lance avec les identifiants SAP."); process.exit(1); }
const agent = new https.Agent({ rejectUnauthorized: g("SAP_B1_TLS_INSECURE") !== "1", keepAlive: true });

function req(p, { method = "GET", body, cookie, headers = {} } = {}) {
  const u = new URL(p.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((res, rej) => {
    const r = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, agent,
        headers: { "Content-Type": "application/json", Accept: "application/json", Prefer: "odata.maxpagesize=200", ...(cookie ? { Cookie: cookie } : {}), ...headers } },
      (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, headers: x.headers, body: b }); }); },
    );
    r.on("error", rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const short = (o, n = 600) => (typeof o === "string" ? o : JSON.stringify(o)).slice(0, n);
const uFields = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => k.startsWith("U_")));

async function readTrcl(cookie, cardCode) {
  // Essais d'exposition, dans l'ordre.
  const esc = cardCode.replace(/'/g, "''");
  const filt = encodeURIComponent(`U_CardCode eq '${esc}'`);
  for (const p of [`U_SERG_TRCL?$filter=${filt}`, `SERG_TRCL?$filter=${filt}`]) {
    const r = await req(p, { cookie });
    if (r.status === 200 && Array.isArray(r.body.value)) return { path: p.split("?")[0], rows: r.body.value };
  }
  // UDO ?
  const o = await req(`UserObjectsMD?$filter=${encodeURIComponent("TableName eq 'SERG_TRCL'")}`, { cookie });
  for (const x of o.body?.value || []) {
    const r = await req(`${encodeURIComponent(x.Code)}?$filter=${filt}`, { cookie });
    if (r.status === 200 && Array.isArray(r.body.value)) return { path: `UDO:${x.Code}`, rows: r.body.value };
  }
  // SQLQueries (dernier recours)
  const codeq = "DIAG_TRCL_TMP2";
  await req(`SQLQueries('${codeq}')`, { cookie, method: "DELETE" });
  const cols = ['"Code"','"U_CardCode"','"U_TrspCode"','"U_DesTransp"','"U_TrspDef"','"U_DistBy"','"U_Heure"',
    '"U_Lundi"','"U_Mardi"','"U_Mercredi"','"U_Jeudi"','"U_Vendredi"','"U_Samedi"','"U_Dimanche"','"U_Rmqs"'].join(",");
  const create = await req("SQLQueries", { cookie, method: "POST", body: { SqlCode: codeq, SqlName: "diag trcl tmp2", SqlText: `SELECT ${cols} FROM "@SERG_TRCL" WHERE "U_CardCode" = '${esc}'` } });
  if (create.status < 400) {
    const list = await req(`SQLQueries('${codeq}')/List`, { cookie, headers: { Prefer: "odata.maxpagesize=200" } });
    if (list.status === 200) return { path: `SQLQueries:${codeq}`, rows: list.body?.value || [] };
  }
  return { path: null, rows: null };
}

async function main() {
  const args = process.argv.slice(2);
  const docNums = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const cardArgIdx = args.indexOf("--card");
  const cardArg = cardArgIdx >= 0 ? args[cardArgIdx + 1] : null;

  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  if (login.status !== 200) { console.error("❌ LOGIN", login.status, short(login.body, 300)); process.exit(1); }
  const set = login.headers["set-cookie"]; const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login OK —", g("SAP_B1_COMPANY_DB"));

  // ── 1. BL cibles : par DocNum, sinon les 6 plus récents (ou du client --card) ──
  let orders = [];
  if (docNums.length) {
    for (const dn of docNums) {
      const r = await req(`Orders?$filter=${encodeURIComponent(`DocNum eq ${dn}`)}`, { cookie });
      if (r.body.value?.[0]) orders.push(r.body.value[0]);
    }
  } else {
    const cf = cardArg ? `CardCode eq '${cardArg.replace(/'/g, "''")}' and ` : "";
    const r = await req(`Orders?$filter=${encodeURIComponent(`${cf}Cancelled eq 'tNO'`)}&$orderby=DocEntry desc&$top=6`, { cookie });
    orders = r.body.value || [];
  }
  console.log(`\n================ 1. BL (${orders.length}) — TOUS les champs U_* ================`);
  for (const o of orders) {
    console.log(`\n• BL DocNum ${o.DocNum} (DocEntry ${o.DocEntry}) — ${o.CardCode} ${o.CardName ?? ""} — DocDate ${o.DocDate} DueDate ${o.DocDueDate}`);
    const us = uFields(o);
    if (Object.keys(us).length === 0) console.log("    (aucun champ U_* au niveau en-tête)");
    for (const [k, v] of Object.entries(us)) console.log(`    ${k} = ${JSON.stringify(v)}`);
  }

  // ── 2. SERG_TRCL des clients concernés ──
  const cards = [...new Set(orders.map((o) => o.CardCode).filter(Boolean))];
  if (cardArg && !cards.includes(cardArg)) cards.push(cardArg);
  console.log(`\n================ 2. SERG_TRCL par client (${cards.length}) ================`);
  const trclByCard = {};
  for (const cc of cards) {
    const { path: tp, rows } = await readTrcl(cookie, cc);
    trclByCard[cc] = rows;
    console.log(`\n• ${cc} — accès: ${tp ?? "❌ NON LISIBLE (aucun chemin SL)"} — ${rows ? rows.length + " ligne(s)" : ""}`);
    for (const r of rows || []) {
      const def = (r.U_TrspDef ?? "").toString().trim().toUpperCase() === "O" ? " ★DÉFAUT" : "";
      console.log(`    Trsp=${JSON.stringify(r.U_TrspCode)} Tournée=${JSON.stringify(r.U_DistBy)} Heure=${JSON.stringify(r.U_Heure)} Des=${JSON.stringify(r.U_DesTransp)}${def}`);
      // toutes les colonnes U_* (pour repérer un éventuel champ "timbre")
      console.log(`      U_*: ${short(uFields(r), 500)}`);
    }
  }

  // ── 3. Corrélation BL ⇄ SERG_TRCL ──
  console.log(`\n================ 3. CORRÉLATION (à interpréter) ================`);
  for (const o of orders) {
    const rows = trclByCard[o.CardCode] || [];
    const match = rows.find((r) => (r.U_TrspCode ?? "").toString().trim() === (o.U_TrspCode ?? "").toString().trim());
    const def = rows.find((r) => (r.U_TrspDef ?? "").toString().trim().toUpperCase() === "O");
    console.log(`\n• BL ${o.DocNum} ${o.CardCode}: U_TrspCode=${JSON.stringify(o.U_TrspCode)} U_TrspHeure=${JSON.stringify(o.U_TrspHeure)} U_Timbre=${JSON.stringify(o.U_Timbre)}`);
    console.log(`    ligne SERG_TRCL correspondante: ${match ? `Heure=${JSON.stringify(match.U_Heure)} Tournée=${JSON.stringify(match.U_DistBy)}` : "(aucune)"}`);
    console.log(`    ligne SERG_TRCL DÉFAUT:          ${def ? `Trsp=${JSON.stringify(def.U_TrspCode)} Heure=${JSON.stringify(def.U_Heure)} Tournée=${JSON.stringify(def.U_DistBy)}` : "(aucune)"}`);
  }
  console.log("\n👉 Conclusion attendue : U_TrspHeure ≟ SERG_TRCL.U_Heure (ligne du transporteur) ; U_Timbre ≟ <quel champ ?>. Colle cette sortie.");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
