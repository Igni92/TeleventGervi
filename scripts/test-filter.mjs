/** Test if SAP B1 supports $filter on Valid/Frozen enums + measure speed. */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      // Strip surrounding quotes if any
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      // Unescape \$ → $ (handle dotenv-style escapes from .env.local)
      v = v.replace(/\\\$/g, "$");
      process.env[m[1]] = v;
    }
  }
}
loadEnv(".env.local");

const BASE = process.env.SAP_B1_BASE_URL;

function req(method, path, { cookies = "", body = null, prefer = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, BASE + "/");
    const r = https.request({
      hostname: target.hostname, port: target.port || 443,
      path: target.pathname + target.search, method,
      rejectUnauthorized: false,
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
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
console.log("Login:", login.status, login.status === 200 ? "OK" : login.body);
if (login.status !== 200) process.exit(1);
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// Test: count without filter
let t = Date.now();
const cAll = await req("GET", "Items/$count", { cookies });
console.log(`Count all: ${cAll.body} (${Date.now()-t}ms)`);

// Test: count with filter Valid=tYES
t = Date.now();
const cValid = await req("GET", "Items/$count?$filter=Valid eq 'tYES'", { cookies });
console.log(`Count Valid=tYES: ${cValid.body} (${Date.now()-t}ms)`);

// Test: count with filter Valid=tYES AND Frozen=tNO
t = Date.now();
const cBoth = await req("GET", "Items/$count?$filter=Valid eq 'tYES' and Frozen eq 'tNO'", { cookies });
console.log(`Count Valid+Frozen: ${cBoth.body} (${Date.now()-t}ms)`);

// Test page 1 with filter
t = Date.now();
const p1 = await req(
  "GET",
  "Items?$filter=Valid eq 'tYES' and Frozen eq 'tNO'&$top=500&$select=ItemCode,ItemName,ItemsGroupCode,SalesUnit,ManageBatchNumbers,QuantityOnStock,ItemWarehouseInfoCollection,Valid,Frozen",
  { cookies, prefer: "odata.maxpagesize=500" }
);
console.log(`Page 1 (filtered, full payload): ${p1.body.value?.length || "ERROR"} items in ${Date.now()-t}ms`);
if (p1.status !== 200) console.log("Error:", p1.body);

await req("POST", "Logout", { cookies });
