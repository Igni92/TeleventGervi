/** Teste si on peut PATCHer DocumentLineAdditionalExpenses sur un order existant. */
import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$"); process.env[m[1]] = v; }
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

// Cherche un smoke order avec une ligne SANS expenses mais LineTotal>0
const r = await req("GET", "Orders?$top=40&$orderby=DocEntry desc", { cookies });
let target = null, lineIdx = -1;
for (const o of (r.body?.value || [])) {
  if (!/SMOKE/.test(o.Comments || "")) continue;
  (o.DocumentLines || []).forEach((l, k) => {
    const hasItfel = (l.DocumentLineAdditionalExpenses||[]).some(e=>e.ExpenseCode===2);
    if (!hasItfel && l.LineTotal > 50 && !target) { target = o; lineIdx = k; }
  });
  if (target) break;
}
if (!target) { console.log("Aucun smoke order sans INTERFEL trouvé dans les 40 derniers."); await req("POST","Logout",{cookies}); process.exit(0); }
const line = target.DocumentLines[lineIdx];
const expectedItfel = Math.round(line.LineTotal * 0.0021 * 100) / 100;
console.log(`Cible: BL #${target.DocNum} DocEntry=${target.DocEntry} L${line.LineNum} ${line.ItemCode} LineTotal=${line.LineTotal} → INTERFEL attendu=${expectedItfel}`);
console.log("Expenses actuels:", JSON.stringify(line.DocumentLineAdditionalExpenses || []));

// Construit la nouvelle liste d'expenses : garde DDG existant, ajoute INTERFEL
const existing = (line.DocumentLineAdditionalExpenses || []).map(e => ({ GroupCode: e.GroupCode, ExpenseCode: e.ExpenseCode, LineTotal: e.LineTotal }));
const merged = [{ GroupCode: 1, ExpenseCode: 2, LineTotal: expectedItfel }, ...existing.filter(e=>e.ExpenseCode!==2)];

// PATCH : on envoie la ligne ciblée avec LineNum + nouvelles expenses
const patchBody = { DocumentLines: [{ LineNum: line.LineNum, DocumentLineAdditionalExpenses: merged }] };
const patch = await req("PATCH", `Orders(${target.DocEntry})`, { cookies, body: patchBody });
console.log("\nPATCH status:", patch.status, patch.status>=400 ? JSON.stringify(patch.body).slice(0,400) : "");

// Refetch
const after = await req("GET", `Orders(${target.DocEntry})`, { cookies });
const l2 = after.body.DocumentLines[lineIdx];
console.log("Après PATCH, expenses L"+lineIdx+":", JSON.stringify(l2.DocumentLineAdditionalExpenses || []));
console.log("DocTotal avant/après:", target.DocTotal, "→", after.body.DocTotal);
await req("POST", "Logout", { cookies });
