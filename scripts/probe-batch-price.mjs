/** Try to retrieve purchase price for a known batch via PurchaseDeliveryNotes. */
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

const login = await req("POST", "Login", { body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD } });
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
console.log("Login:", login.status, "\n");

// 1. Get a recent PurchaseDeliveryNote with full lines + batches
console.log("== Recent PurchaseDeliveryNote with batches ==");
const pdn = await req("GET", "PurchaseDeliveryNotes?$top=1&$orderby=DocEntry desc", { cookies });
if (pdn.body.value?.[0]) {
  const doc = pdn.body.value[0];
  console.log(`Doc ${doc.DocNum} | ${doc.DocDate} | ${doc.CardName}`);
  console.log("Top-level fields containing 'batch':", Object.keys(doc).filter(k => /batch/i.test(k)));

  const line = doc.DocumentLines?.[0];
  if (line) {
    console.log("\nLine 1 fields containing 'batch':", Object.keys(line).filter(k => /batch/i.test(k)));
    console.log("Line 1 sample:");
    console.log("  ItemCode:", line.ItemCode);
    console.log("  Price:", line.Price);
    console.log("  Quantity:", line.Quantity);
    if (line.BatchNumbers) {
      console.log("  BatchNumbers array:");
      (line.BatchNumbers || []).slice(0, 3).forEach(b => {
        console.log("   ", JSON.stringify(b));
      });
    }
  }
}

// 2. Try filter by batch number
console.log("\n== Try filter on BatchNumber EM14878 ==");
const f1 = await req("GET", "PurchaseDeliveryNotes?$top=2&$filter=DocumentLines/any(l: l/BatchNumbers/any(b: b/BatchNumber eq 'EM14878'))", { cookies });
console.log("Status:", f1.status);
if (f1.status === 200) {
  console.log("Found:", f1.body.value?.length, "documents");
  (f1.body.value || []).forEach(d => {
    console.log(`  Doc ${d.DocNum} | ${d.DocDate} | ${d.CardName}`);
    (d.DocumentLines || []).forEach(l => {
      if (l.ItemCode === "KE27F") {
        console.log(`    KE27F: price=${l.Price}, qty=${l.Quantity}, currency=${l.Currency}`);
        (l.BatchNumbers || []).forEach(b => {
          if (b.BatchNumber === "EM14878") console.log(`      Lot match: qty=${b.Quantity}`);
        });
      }
    });
  });
} else {
  console.log("Error:", f1.body?.error?.message?.value);
}

await req("POST", "Logout", { cookies });
