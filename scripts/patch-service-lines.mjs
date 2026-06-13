/**
 * Patch ciblé : re-pull les Invoices/Orders ayant 0 ligne en DB (= service-only
 * filtrées dans le backfill initial parce qu'elles n'ont pas d'ItemCode).
 *
 * Maintenant que le schéma autorise itemCode=null + isService=true, on garde
 * ces lignes pour cohérence (sinon DocTotal compte mais marge=0 artificielle).
 *
 * Cas typique : location de local refacturée à un client (cf. SOFRUCE CLT).
 */
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
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}
loadEnv(".env.local");

const SAP_BASE = process.env.SAP_B1_BASE_URL;
let cookies = "";

function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    const encoded = encodeURI(path);
    const t = new URL(encoded, SAP_BASE.endsWith("/") ? SAP_BASE : SAP_BASE + "/");
    const r = https.request({
      hostname: t.hostname, port: t.port || 443, path: t.pathname + t.search, method,
      rejectUnauthorized: false,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookies ? { Cookie: cookies } : {}) },
    }, (resp) => {
      let d = "";
      resp.on("data", (c) => d += c);
      resp.on("end", () => {
        let p = d;
        try { p = JSON.parse(d); } catch {}
        res({ status: resp.statusCode, body: p, headers: resp.headers });
      });
    });
    r.on("error", rej);
    if (opts.body) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

const prisma = new PrismaClient();

async function main() {
  // 1. Login
  const r = await req("POST", "Login", { body: {
    CompanyDB: process.env.SAP_B1_COMPANY_DB,
    UserName: process.env.SAP_B1_USERNAME,
    Password: process.env.SAP_B1_PASSWORD,
  } });
  if (r.status !== 200) throw new Error("Login: " + r.status);
  cookies = (r.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  console.log("✅ Login OK");

  // 2. Find target Invoices = 0 ligne en DB
  const allInv = await prisma.sapInvoice.findMany({
    where: { cancelled: false, docTotal: { gt: 0 } },
    select: { docEntry: true, docNum: true, docTotal: true, cardCode: true, cardName: true },
  });
  const docEntries = allInv.map((i) => i.docEntry);
  const lineCount = await prisma.sapInvoiceLine.groupBy({
    by: ["docEntry"],
    where: { docEntry: { in: docEntries } },
    _count: { id: true },
  });
  const lineMap = new Map(lineCount.map((l) => [l.docEntry, l._count.id]));
  const targets = allInv.filter((i) => (lineMap.get(i.docEntry) ?? 0) === 0);

  console.log(`🎯 ${targets.length} Invoices à patcher (0 ligne en DB) :`);
  targets.forEach((t) => console.log(`   - DocNum ${t.docNum} (DocEntry ${t.docEntry}) ${t.cardName ?? t.cardCode} : ${t.docTotal} €`));

  // 3. Pour chaque target, re-fetch ses DocumentLines depuis SAP
  let patched = 0, serviceLines = 0;
  for (const t of targets) {
    const r2 = await req("GET", `Invoices(${t.docEntry})?$expand=DocumentLines`);
    if (r2.status !== 200) {
      console.log(`   ❌ ${t.docNum}: ${r2.status}`);
      continue;
    }
    const doc = r2.body;
    const docLines = doc.DocumentLines ?? [];
    if (docLines.length === 0) {
      console.log(`   ⚠️  ${t.docNum}: 0 lignes dans SAP non plus`);
      continue;
    }

    // Re-insert toutes les lignes (sans filter, avec isService=true si pas d'ItemCode)
    await prisma.sapInvoiceLine.deleteMany({ where: { docEntry: t.docEntry } });
    let headerGp = 0;
    const linesData = docLines.map((l) => {
      const qty = l.Quantity ?? 0;
      const lineTotal = l.LineTotal ?? 0;
      const cost = l.StockPrice ?? null;
      const gp = cost != null ? lineTotal - qty * cost : null;
      if (gp != null) headerGp += gp;
      const noItem = l.ItemCode == null || l.ItemCode === "";
      if (noItem) serviceLines++;
      return {
        docEntry: t.docEntry,
        lineNum: l.LineNum,
        itemCode: noItem ? null : l.ItemCode,
        itemDescription: l.ItemDescription ?? null,
        quantity: qty,
        lineTotal,
        lineCost: cost,
        grossProfit: gp,
        warehouseCode: l.WarehouseCode ?? null,
        isService: noItem,
      };
    });
    await prisma.sapInvoiceLine.createMany({ data: linesData });
    await prisma.sapInvoice.update({
      where: { docEntry: t.docEntry },
      data: { grossProfit: Math.round(headerGp * 100) / 100, syncedAt: new Date() },
    });
    console.log(`   ✅ ${t.docNum}: ${linesData.length} lignes (${linesData.filter(l => l.isService).length} service)`);
    patched++;
  }

  console.log(`\n🎯 ${patched} Invoices patchées · ${serviceLines} lignes service récupérées`);

  // Logout
  await req("POST", "Logout");
  await prisma.$disconnect();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
