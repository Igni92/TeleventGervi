/**
 * Normalise + dédoublonne la liste des prospects GMS (data/prospects-gms-idf.json).
 *
 *  • Attribue un CODE ENSEIGNE court et homogène (A=Auchan, ITM=Intermarché,
 *    U=Super/Hyper U, L=Leclerc, CARR=Carrefour, MONO=Monoprix, …).
 *  • Dédoublonne par (SIREN + adresse normalisée) — même magasin listé 2×.
 *  • Réécrit le JSON enrichi (champ `enseigneCode`) et exporte un Excel lisible.
 *
 * Usage : node scripts/normalize-prospects.mjs [chemin_xlsx_sortie]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../data/prospects-gms-idf.json");
const XLSX_OUT = resolve(process.argv[2] || resolve(__dirname, "../prospects-gms-idf.xlsx"));

/**
 * Nomenclature enseigne : première règle qui matche (recherche dans TOUTE la
 * chaîne en majuscules). `code` court + `label` propre. Fallback = AUTRE.
 */
const RULES = [
  { code: "A",       label: "Auchan",        re: /\bAUCHAN\b|\bSIMPLY\b|MY AUCHAN/ },
  { code: "ITM",     label: "Intermarché",   re: /INTERMARCHE|MOUSQUETAIRES|\bITM\b|\bNETTO\b/ },
  { code: "U",       label: "Système U",     re: /\b(SUPER|HYPER|SYSTEME|MARCHE)\s*U\b|\bU\s*EXPRESS\b|\bUTILE\b|\bU\b/ },
  { code: "L",       label: "Leclerc",       re: /LECLERC/ },
  { code: "CARR",    label: "Carrefour",     re: /CARREFOUR/ },
  { code: "MONO",    label: "Monoprix",      re: /MONOPRIX|MONOP\b/ },
  { code: "FP",      label: "Franprix",      re: /FRANPRIX/ },
  { code: "CASINO",  label: "Casino/Géant",  re: /CASINO|\bGEANT\b|PETIT CASINO|VIVAL|SPAR\b/ },
  { code: "CORA",    label: "Cora",          re: /\bCORA\b/ },
  { code: "LIDL",    label: "Lidl",          re: /\bLIDL\b/ },
  { code: "ALDI",    label: "Aldi",          re: /\bALDI\b/ },
  { code: "COSTCO",  label: "Costco",        re: /COSTCO/ },
  { code: "GE",      label: "Grande Épicerie", re: /GRANDE EPICERIE|SEGEP/ },
  { code: "NATU",    label: "Naturalia",     re: /NATURALIA/ },
  { code: "BIO",     label: "Biocoop/Bio",   re: /BIOCOOP|\bBIO\b/ },
  { code: "G20",     label: "G20",           re: /\bG\s*20\b/ },
  { code: "COCCI",   label: "Coccinelle",    re: /COCCI/ },
  { code: "PROXI",   label: "Proxi",         re: /\bPROXI\b/ },
  { code: "MF",      label: "Marché Frais",  re: /MARCHE FRAIS|GRAND FRAIS|MARCHE FRANC/ },
];

function classify(enseigne) {
  const s = (enseigne || "").toUpperCase();
  for (const r of RULES) if (r.re.test(s)) return { code: r.code, label: r.label };
  return { code: "AUTRE", label: "Indépendant / autre" };
}

/**
 * Probabilité de LABO PÂTISSERIE — scoring STRICT (au niveau magasin, la plupart
 * n'ont PAS de labo) :
 *   • Élevée      = hypermarché d'une grande enseigne (labo quasi-certain) ;
 *   • Moyenne     = autre hypermarché (à vérifier) ;
 *   • À qualifier = tout le reste (supers, convenience, indépendants) → sans labo probable.
 */
const HYPER_LABO = new Set(["CARR", "A", "L", "CORA", "CASINO", "GE", "COSTCO"]);
function scoreProba(type, code) {
  if (type === "Hyper" && HYPER_LABO.has(code)) return "Élevée";
  if (type === "Hyper") return "Moyenne";
  return "À qualifier";
}

const normAddr = (a) => (a || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const data = JSON.parse(readFileSync(SRC, "utf8"));
const seen = new Set();
const out = [];
let dups = 0;
for (const p of data) {
  const key = `${p.siren || ""}|${normAddr(p.adresse) || `${p.enseigne}|${p.cp}`}`;
  if (seen.has(key)) { dups++; continue; }
  seen.add(key);
  const { code, label } = classify(p.enseigne);
  out.push({ ...p, enseigneCode: code, enseigneLabel: label, proba: scoreProba(p.type, code) });
}

// Réécrit le JSON enrichi + dédoublonné (source unique pour l'app).
writeFileSync(SRC, JSON.stringify(out, null, 0));

// Stats par code enseigne.
const byCode = {};
for (const p of out) byCode[p.enseigneCode] = (byCode[p.enseigneCode] || 0) + 1;
const codes = Object.entries(byCode).sort((a, b) => b[1] - a[1]);

// Export Excel.
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Prospects GMS IDF");
ws.columns = [
  { header: "Code", key: "enseigneCode", width: 8 },
  { header: "Enseigne", key: "enseigneLabel", width: 20 },
  { header: "Format", key: "type", width: 8 },
  { header: "Nom brut (SIRENE)", key: "enseigne", width: 40 },
  { header: "Ville", key: "ville", width: 22 },
  { header: "CP", key: "cp", width: 8 },
  { header: "Dépt", key: "dept", width: 6 },
  { header: "Proba labo", key: "proba", width: 12 },
  { header: "Adresse", key: "adresse", width: 46 },
  { header: "SIREN", key: "siren", width: 12 },
];
ws.getRow(1).font = { bold: true };
ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
ws.autoFilter = "A1:J1";
ws.views = [{ state: "frozen", ySplit: 1 }];
out
  .slice()
  .sort((a, b) => (a.enseigneLabel).localeCompare(b.enseigneLabel) || (a.ville || "").localeCompare(b.ville || ""))
  .forEach((p) => ws.addRow(p));

// Onglet récap par enseigne.
const ws2 = wb.addWorksheet("Récap enseignes");
ws2.columns = [
  { header: "Code", key: "code", width: 10 },
  { header: "Enseigne", key: "label", width: 24 },
  { header: "Nombre de sites", key: "n", width: 16 },
];
ws2.getRow(1).font = { bold: true };
const labelOf = (c) => RULES.find((r) => r.code === c)?.label || "Indépendant / autre";
codes.forEach(([code, n]) => ws2.addRow({ code, label: labelOf(code), n }));

await wb.xlsx.writeFile(XLSX_OUT);

console.log(`Source: ${data.length} lignes → ${out.length} après dédoublonnage (${dups} doublons retirés).`);
console.log(`Excel écrit: ${XLSX_OUT}`);
console.log("Répartition par code enseigne:");
for (const [c, n] of codes) console.log(`  ${String(n).padStart(4)}  ${c.padEnd(7)} ${labelOf(c)}`);
