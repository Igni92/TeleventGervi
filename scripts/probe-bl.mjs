/** Probe SAP B1 DeliveryNotes structure on GERVIFRAIS_TEST. */
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

const login = await req("POST", "Login", {
  body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD },
});
console.log("DB:", process.env.SAP_B1_COMPANY_DB, "| Login:", login.status, login.status === 200 ? "OK" : login.body);
if (login.status !== 200) process.exit(1);
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// 1. Get a recent DeliveryNote (sales delivery to customer)
console.log("\n== 1. DeliveryNotes (vente client) — 1 exemple ==");
const dn = await req("GET", "DeliveryNotes?$top=1&$orderby=DocEntry desc", { cookies });
if (dn.body.value?.[0]) {
  const doc = dn.body.value[0];
  const interesting = [
    "DocEntry","DocNum","DocType","DocDate","DocDueDate","CardCode","CardName",
    "Series","SalesPersonCode","Comments","JournalMemo","NumAtCard",
    "DocCurrency","DocTotal","TaxDate","TransportationCode","Indicator",
    "Address","Address2","ShipToCode","PayToCode",
  ];
  interesting.forEach(k => {
    if (doc[k] != null && doc[k] !== "" && doc[k] !== 0) {
      console.log(`  ${k.padEnd(28)} : ${JSON.stringify(doc[k])}`);
    }
  });
  console.log("\n  --- Document Line[0] ---");
  const line = doc.DocumentLines?.[0];
  if (line) {
    const lineInteresting = [
      "LineNum","ItemCode","ItemDescription","Quantity","Price","PriceAfterVAT",
      "Currency","DiscountPercent","WarehouseCode","SalesPersonCode","UnitPrice",
      "U_OPRQQTY","TaxCode","VatGroup","LineTotal","BaseEntry","BaseType","BaseLine",
      "MeasureUnit","UoMEntry","UoMCode","UnitsOfMeasurment","NumPerMsr",
    ];
    lineInteresting.forEach(k => {
      if (line[k] != null && line[k] !== "" && line[k] !== 0) {
        console.log(`  ${k.padEnd(28)} : ${JSON.stringify(line[k])}`);
      }
    });
    if (line.BatchNumbers?.length) {
      console.log("\n  BatchNumbers:", JSON.stringify(line.BatchNumbers.slice(0, 2), null, 2));
    }
  }
} else {
  console.log("Aucun BL trouvé. Body:", dn.body);
}

// 2. List Series for DeliveryNotes (numéroteurs)
console.log("\n== 2. Series disponibles pour DeliveryNotes ==");
const series = await req("GET", "Series?$filter=Document eq '15' or Document eq '15-OINV'", { cookies });
if (series.body.value?.length) {
  series.body.value.slice(0, 5).forEach(s => {
    console.log(`  Series ${s.Series} | ${s.Name || "?"} | NextNumber=${s.NextNumber} | Document=${s.Document}`);
  });
} else {
  console.log("Status:", series.status, series.body?.error?.message?.value || "—");
  // Try without filter
  const allSeries = await req("GET", "Series?$top=10", { cookies });
  if (allSeries.body.value?.[0]) {
    console.log("  Keys d'une series:", Object.keys(allSeries.body.value[0]).join(", "));
    console.log("  Échantillon:", JSON.stringify(allSeries.body.value[0], null, 2));
  }
}

// 3. SalesPersons (commerciaux SAP)
console.log("\n== 3. SalesPersons (sample) ==");
const sp = await req("GET", "SalesPersons?$top=5&$select=SalesEmployeeCode,SalesEmployeeName,Active", { cookies });
(sp.body.value || []).forEach(s => console.log(`  ${s.SalesEmployeeCode} | ${s.SalesEmployeeName} | active=${s.Active}`));

await req("POST", "Logout", { cookies });
console.log("\n🔚 Done.");
