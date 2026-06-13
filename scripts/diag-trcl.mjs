/**
 * Enquête SERG_TRCL (UDT « tournées clients ») — LECTURE SEULE.
 *
 * Objectif : déterminer COMMENT lire l'UDT via le Service Layer et sa structure
 * réelle (clé client, champs transporteur/tournée, lignes par client).
 *
 * Sondes, dans l'ordre :
 *   1. GET UserTablesMD('SERG_TRCL')          — métadonnées de la table
 *   2. GET UserFieldsMD (TableName=@SERG_TRCL) — définition des champs
 *   3. GET SERG_TRCL?$top=3                    — exposition directe (attendu : 404)
 *   4. GET U_SERG_TRCL?$top=5                  — exposition UDT standard SL
 *      + $count + $filter=U_CardCode eq 'APLAI' / 'ANOYON'
 *   5. (seulement si 4 échoue) POST SQLQueries + GET .../List — dernier recours
 *
 * Référence structure déjà connue (sap_scrape/sap_export/UserFieldsMD.csv) :
 *   CardCode, TrspCode, Lundi..Dimanche (O/N), Heure, DesTransp, TrspDef (O/N),
 *   RmqLundi, Rmqs, DistBy, DateMaj, ModBy, Rmqs2
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

// ── Plumbing env (.env + .env.local, déséchappement \$) ──────────────────────
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

function req(p, { method = "GET", body, cookie, headers = {} } = {}) {
  const u = new URL(p.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((res, rej) => {
    const r = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, agent,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers } },
      (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, body: b }); }); },
    );
    r.on("error", rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

const short = (o, n = 600) => JSON.stringify(o).slice(0, n);

async function main() {
  // Login bas niveau (capture du set-cookie B1SESSION).
  const cookie = await new Promise((res, rej) => {
    const u = new URL("Login", BASE.endsWith("/") ? BASE : BASE + "/");
    const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname, method: "POST", agent, headers: { "Content-Type": "application/json" } },
      (x) => {
        let d = ""; x.on("data", (c) => (d += c));
        x.on("end", () => {
          if (x.statusCode !== 200) return rej(new Error(`LOGIN FAIL ${x.statusCode}: ${d.slice(0, 300)}`));
          res((x.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; "));
        });
      });
    r.on("error", rej);
    r.write(JSON.stringify({ CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") }));
    r.end();
  });
  console.log("Login OK (PROD:", g("SAP_B1_COMPANY_DB"), ")");
  const C = { cookie };

  // ── 1. Métadonnées table ────────────────────────────────────────────────
  console.log("\n=== 1. UserTablesMD('SERG_TRCL') ===");
  const t = await req("UserTablesMD('SERG_TRCL')", C);
  console.log("status", t.status, "→", short(t.body, 400));

  // ── 2. Champs ───────────────────────────────────────────────────────────
  console.log("\n=== 2. UserFieldsMD (TableName eq '@SERG_TRCL') ===");
  const f = await req(`UserFieldsMD?$filter=${encodeURIComponent("TableName eq '@SERG_TRCL'")}&$select=Name,Type,Description,FieldID`, C);
  if (f.status === 200) for (const x of f.body.value || []) console.log(`  ${x.FieldID}. ${x.Name} (${x.Type}) — ${x.Description}`);
  else console.log("status", f.status, short(f.body, 200));

  // ── 3. Exposition directe (sans U_) ─────────────────────────────────────
  console.log("\n=== 3. GET SERG_TRCL?$top=3 ===");
  const d = await req("SERG_TRCL?$top=3", C);
  console.log("status", d.status, d.status !== 200 ? short(d.body, 200) : `→ ${d.body.value?.length} lignes`);

  // ── 4. Exposition UDT standard : U_SERG_TRCL ────────────────────────────
  console.log("\n=== 4. GET U_SERG_TRCL?$top=5 ===");
  const u = await req("U_SERG_TRCL?$top=5", C);
  console.log("status", u.status);
  let udtOk = false;
  if (u.status === 200 && Array.isArray(u.body.value)) {
    udtOk = true;
    const rows = u.body.value;
    console.log("Colonnes:", Object.keys(rows[0] || {}).join(", "));
    for (const r of rows) console.log(" ", short(r, 400));

    const cnt = await req("U_SERG_TRCL/$count", C);
    console.log("\n$count →", cnt.status, cnt.body);

    for (const cc of ["APLAI", "ANOYON"]) {
      const r = await req(`U_SERG_TRCL?$filter=${encodeURIComponent(`U_CardCode eq '${cc}'`)}`, C);
      console.log(`\n$filter U_CardCode eq '${cc}' → ${r.status}, ${r.body.value?.length ?? "?"} ligne(s)`);
      for (const x of r.body.value || []) console.log(" ", short(x, 500));
    }

    // Distribution U_TrspDef (combien de lignes « par défaut » ?)
    const def = await req(`U_SERG_TRCL?$filter=${encodeURIComponent("U_TrspDef eq 'O'")}&$select=Code,U_CardCode,U_TrspCode,U_DistBy&$top=5`, C);
    console.log(`\n$filter U_TrspDef eq 'O' → ${def.status}, échantillon:`, short(def.body.value, 500));
    const defCnt = await req(`U_SERG_TRCL/$count?$filter=${encodeURIComponent("U_TrspDef eq 'O'")}`, C);
    console.log("count TrspDef='O' →", defCnt.status, defCnt.body);
  } else {
    console.log(short(u.body, 300));
  }

  // ── 4b. Table MasterData → probablement attachée à un UDO. Cherche le UDO. ──
  if (!udtOk) {
    console.log("\n=== 4b. UserObjectsMD (UDO lié à SERG_TRCL ?) ===");
    const o = await req(`UserObjectsMD?$filter=${encodeURIComponent("TableName eq 'SERG_TRCL'")}`, C);
    console.log("status", o.status);
    const udos = o.body?.value || [];
    for (const x of udos) console.log("  UDO:", short({ Code: x.Code, Name: x.Name, TableName: x.TableName, ObjectType: x.ObjectType, CanLog: x.CanLog }, 400));
    if (!udos.length && o.status === 200) console.log("  (aucun UDO sur cette table)");

    // Si un UDO existe, le SL l'expose sous son Code.
    for (const x of udos) {
      const svc = await req(`${encodeURIComponent(x.Code)}?$top=3`, C);
      console.log(`  GET ${x.Code}?$top=3 → ${svc.status}`, svc.status === 200 ? `cols: ${Object.keys(svc.body.value?.[0] || {}).join(", ")}` : short(svc.body, 150));
      if (svc.status === 200) {
        udtOk = true;
        for (const r of svc.body.value || []) console.log("   ", short(r, 400));
      }
    }
  }

  // ── 5. SQLQueries — colonnes EXPLICITES (l'astérisque est refusé) ──────────
  if (!udtOk) {
    console.log("\n=== 5. Fallback SQLQueries (colonnes explicites) ===");
    const code = "DIAG_TRCL_TMP";
    const cols = ['"Code"', '"Name"', '"U_CardCode"', '"U_TrspCode"', '"U_DesTransp"', '"U_TrspDef"', '"U_DistBy"',
      '"U_Lundi"', '"U_Mardi"', '"U_Mercredi"', '"U_Jeudi"', '"U_Vendredi"', '"U_Samedi"', '"U_Dimanche"',
      '"U_Heure"', '"U_Rmqs"', '"U_Rmqs2"', '"U_DateMaj"'].join(",");
    // Nettoie un éventuel reliquat d'un run précédent.
    await req(`SQLQueries('${code}')`, { ...C, method: "DELETE" });
    const create = await req("SQLQueries", { ...C, method: "POST", body: { SqlCode: code, SqlName: "diag trcl tmp", SqlText: `SELECT ${cols} FROM "@SERG_TRCL"` } });
    console.log("POST SQLQueries →", create.status, create.status >= 400 ? short(create.body, 300) : "OK");
    if (create.status < 400) {
      const list = await req(`SQLQueries('${code}')/List`, C);
      console.log("GET List →", list.status);
      const rows = list.body?.value || [];
      console.log("Nb lignes (1re page):", rows.length, "| nextLink:", list.body?.["@odata.nextLink"] ?? "(absent)");
      console.log("Colonnes:", Object.keys(rows[0] || {}).join(", "));
      for (const r of rows.slice(0, 6)) console.log(" ", short(r, 500));
      // Lignes d'un client connu + page size élargie
      const big = await req(`SQLQueries('${code}')/List`, { ...C, headers: { Prefer: "odata.maxpagesize=500" } });
      const bigRows = big.body?.value || [];
      console.log("\nAvec Prefer maxpagesize=500 → ", big.status, "lignes:", bigRows.length, "| nextLink:", big.body?.["@odata.nextLink"] ?? "(absent)");
      const aplai = bigRows.filter((r) => (r.U_CardCode || "").trim() === "APLAI");
      const anoyon = bigRows.filter((r) => (r.U_CardCode || "").trim() === "ANOYON");
      console.log("Lignes APLAI:", JSON.stringify(aplai));
      console.log("Lignes ANOYON:", JSON.stringify(anoyon));
      const multi = new Map();
      for (const r of bigRows) { const k = (r.U_CardCode || "").trim(); multi.set(k, (multi.get(k) || 0) + 1); }
      const multiClients = [...multi.entries()].filter(([, n]) => n > 1);
      console.log("Clients multi-lignes:", multiClients.length, "ex:", JSON.stringify(multiClients.slice(0, 8)));
      const defs = bigRows.filter((r) => r.U_TrspDef === "O").length;
      console.log(`U_TrspDef='O' : ${defs}/${bigRows.length} lignes ; valeurs DistBy distinctes:`, JSON.stringify([...new Set(bigRows.map((r) => r.U_DistBy).filter(Boolean))].slice(0, 20)));
      console.log("Valeurs TrspCode distinctes:", JSON.stringify([...new Set(bigRows.map((r) => (r.U_TrspCode || "").trim()).filter(Boolean))]));
      const del = await req(`SQLQueries('${code}')`, { ...C, method: "DELETE" });
      console.log("cleanup DELETE →", del.status);
    }
  } else {
    console.log("\n=== 5. SQLQueries non nécessaire (UDT lisible directement) ===");
  }

  // ── 6. Round 2 (si toujours rien) : exposition $metadata, contrôle OCRD,
  //       variantes de syntaxe SQL, endpoint v2. ──────────────────────────────
  if (!udtOk) {
    console.log("\n=== 6a. $metadata contient-il SERG_TRCL ? ===");
    const meta = await req("$metadata", { ...C, headers: { Accept: "application/xml" } });
    const xml = typeof meta.body === "string" ? meta.body : JSON.stringify(meta.body);
    const hits = (xml.match(/[\w."]*SERG_TRCL[\w."]*/g) || []).slice(0, 10);
    console.log("status", meta.status, "| taille", xml.length, "| occurrences SERG_TRCL:", hits.length ? hits.join(" ; ") : "AUCUNE → entité non exposée");
    const otherU = [...new Set(xml.match(/EntitySet Name="U_[\w]+"/g) || [])].slice(0, 15);
    console.log("EntitySets U_* exposés (échantillon):", otherU.join(", ") || "(aucun)");

    console.log("\n=== 6b. Contrôle : SQLQueries sur OCRD (table exposée) ===");
    const ctl = "DIAG_TRCL_CTL";
    await req(`SQLQueries('${ctl}')`, { ...C, method: "DELETE" });
    const cc = await req("SQLQueries", { ...C, method: "POST", body: { SqlCode: ctl, SqlName: "diag ctl ocrd", SqlText: 'SELECT "CardCode", "CardName" FROM OCRD WHERE "CardCode" = \'APLAI\'' } });
    console.log("POST (OCRD) →", cc.status, cc.status >= 400 ? short(cc.body, 250) : "OK");
    if (cc.status < 400) {
      const l = await req(`SQLQueries('${ctl}')/List`, C);
      console.log("List →", l.status, short(l.body?.value, 250));
      await req(`SQLQueries('${ctl}')`, { ...C, method: "DELETE" });
    }

    console.log("\n=== 6c. Variantes de syntaxe sur @SERG_TRCL ===");
    const variants = [
      'SELECT "U_CardCode","U_TrspCode" FROM [@SERG_TRCL]',
      'SELECT T0."U_CardCode", T0."U_TrspCode" FROM "@SERG_TRCL" T0',
      'SELECT "U_CardCode","U_TrspCode" FROM "@SERG_TRCL"',
    ];
    for (const [i, sql] of variants.entries()) {
      const vcode = `DIAG_TRCL_V${i}`;
      await req(`SQLQueries('${vcode}')`, { ...C, method: "DELETE" });
      const r = await req("SQLQueries", { ...C, method: "POST", body: { SqlCode: vcode, SqlName: `diag trcl v${i}`, SqlText: sql } });
      console.log(`POST [${sql.slice(0, 60)}…] → ${r.status}`, r.status >= 400 ? short(r.body, 200) : "OK");
      if (r.status < 400) {
        const l = await req(`SQLQueries('${vcode}')/List`, C);
        console.log("  List →", l.status, short(l.body?.value, 400));
        await req(`SQLQueries('${vcode}')`, { ...C, method: "DELETE" });
        if (l.status === 200) { udtOk = true; break; }
      }
    }

    console.log("\n=== 6d. Endpoint v2 : /b1s/v2/U_SERG_TRCL ===");
    // BASE pointe sur /b1s/v1 → remplace par v2 (session partagée ? on re-loggue en v2).
    const base2 = BASE.replace(/\/b1s\/v1\/?$/, "/b1s/v2");
    if (base2 !== BASE) {
      const cookie2 = await new Promise((res) => {
        const u = new URL("Login", base2 + "/");
        const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname, method: "POST", agent, headers: { "Content-Type": "application/json" } },
          (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => res(x.statusCode === 200 ? (x.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ") : null)); });
        r.on("error", () => res(null));
        r.write(JSON.stringify({ CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") }));
        r.end();
      });
      if (!cookie2) { console.log("login v2 impossible"); }
      else {
        const u2 = new URL("U_SERG_TRCL?$top=3", base2 + "/");
        const r2 = await new Promise((res, rej) => {
          const r = https.request({ hostname: u2.hostname, port: u2.port || 443, path: u2.pathname + u2.search, method: "GET", agent, headers: { Accept: "application/json", Cookie: cookie2 } },
            (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, body: b }); }); });
          r.on("error", rej); r.end();
        });
        console.log("GET v2 U_SERG_TRCL →", r2.status, r2.status === 200 ? short(r2.body?.value, 400) : short(r2.body, 200));
      }
    } else console.log("BASE ne finit pas par /b1s/v1 — variante v2 non testable:", BASE);
  }

  await req("Logout", { ...C, method: "POST" });
  console.log("\nFin enquête.");
}

main().catch((e) => console.error("ERR", e.message));
