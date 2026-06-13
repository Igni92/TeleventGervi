import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$"); process.env[m[1]] = v;
    }
  }
}
loadEnv(".env.local");
function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    const t = new URL(path, process.env.SAP_B1_BASE_URL + "/");
    const r = https.request({ hostname: t.hostname, port: t.port || 443, path: t.pathname + t.search, method,
      rejectUnauthorized: false, headers: { "Content-Type": "application/json", ...(opts.cookies ? { Cookie: opts.cookies } : {}) } },
      (resp) => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { let p = d; try { p = JSON.parse(d); } catch {}; res({ status: resp.statusCode, body: p, headers: resp.headers }); }); });
    r.on("error", rej); if (opts.body) r.write(JSON.stringify(opts.body)); r.end();
  });
}
const login = await req("POST", "Login", { body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD } });
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
for (let i = 1; i <= 10; i++) {
  const r = await req("GET", `AdditionalExpenses(${i})`, { cookies });
  if (r.status === 200) {
    const e = r.body;
    console.log(`ExpensCode=${e.ExpensCode} | ${(e.Name || "").padEnd(20)} | U_Taux=${e.U_Taux} | VAT=${e.OutputVATGroup} | DistMethod=${e.DistributionMethod} | DrawingMethod=${e.DrawingMethod} | TaxLiable=${e.TaxLiable}`);
  } else {
    console.log(`(${i}) → ${r.status}`);
    break;
  }
}
await req("POST", "Logout", { cookies });
