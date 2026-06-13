/** Vérifie quels clients TeleVente existent dans la DB TEST. */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";
import { PrismaClient } from "@prisma/client";

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
console.log("DB:", process.env.SAP_B1_COMPANY_DB, "\n");

// Get all TeleVent client codes
const prisma = new PrismaClient();
const televentClients = await prisma.client.findMany({
  select: { code: true, nom: true },
  orderBy: { code: "asc" },
});
console.log(`${televentClients.length} clients TeleVent à vérifier\n`);

// Check each in SAP (parallèle par chunks)
const CHUNK = 5;
const missing = [];
const exists = [];
for (let i = 0; i < televentClients.length; i += CHUNK) {
  const slice = televentClients.slice(i, i + CHUNK);
  await Promise.all(slice.map(async (c) => {
    const r = await req("GET",
      `BusinessPartners('${encodeURIComponent(c.code)}')?$select=CardCode,CardName,Valid,Frozen`,
      { cookies });
    if (r.status === 200) {
      exists.push({ televentCode: c.code, televentNom: c.nom, sapName: r.body.CardName, valid: r.body.Valid, frozen: r.body.Frozen });
    } else {
      missing.push({ televentCode: c.code, televentNom: c.nom, status: r.status });
    }
  }));
}

console.log(`✅ ${exists.length} clients trouvés en SAP TEST`);
exists.slice(0, 5).forEach(e => console.log(`  ${e.televentCode.padEnd(12)} → ${e.sapName} (valid=${e.valid}, frozen=${e.frozen})`));
if (exists.length > 5) console.log(`  ... et ${exists.length - 5} autres`);

console.log(`\n❌ ${missing.length} clients MANQUANTS en SAP TEST :`);
missing.forEach(m => console.log(`  ${m.televentCode.padEnd(12)} ${m.televentNom}`));

await req("POST", "Logout", { cookies });
await prisma.$disconnect();
