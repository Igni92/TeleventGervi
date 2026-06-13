/** Vérifie l'existence d'un BL + liste les DBs accessibles. */
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

// Try multiple DB names to find which work + which contain BL #19
const dbs = [
  "GERVIFRAIS",
  "GERVIFRAIS_TEST",
  "GERVIFRAIS_TEST2",
  "GERVIFRAIS TEST 2",
  "GERVIFRAIS_TEST_2",
  "GERVIFRAIS TEST",
];

console.log("🔍 Test de chaque DB possible…\n");

for (const db of dbs) {
  const login = await req("POST", "Login", {
    body: { CompanyDB: db, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD },
  });
  if (login.status !== 200) {
    console.log(`❌ "${db}" → ${login.body?.error?.message?.value || login.status}`);
    continue;
  }
  console.log(`✅ "${db}" → connecté`);
  const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

  // Latest 5 BL
  const last = await req(
    "GET",
    "DeliveryNotes?$top=5&$orderby=DocEntry desc&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal",
    { cookies },
  );
  const docs = last.body?.value || [];
  console.log(`   ${docs.length} derniers BL :`);
  docs.forEach((d) => {
    console.log(`     #${d.DocNum} (entry ${d.DocEntry}) | ${d.DocDate} | ${d.CardCode} ${d.CardName || ""} | ${d.DocTotal}€`);
  });

  // Specifically check #19
  const bl19 = await req(
    "GET",
    "DeliveryNotes?$filter=DocNum eq 19&$top=1&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Comments",
    { cookies },
  );
  if (bl19.body?.value?.[0]) {
    console.log(`   🎯 BL #19 trouvé : ${JSON.stringify(bl19.body.value[0])}`);
  } else {
    console.log(`   (pas de BL #19 dans cette DB)`);
  }

  await req("POST", "Logout", { cookies });
  console.log();
}
