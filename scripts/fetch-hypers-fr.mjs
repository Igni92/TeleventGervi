/**
 * Collecte NATIONALE des hypermarchés (NAF 47.11F) via l'API publique
 * recherche-entreprises.api.gouv.fr, filtrée par effectif.
 *
 *  Phase 1 — indépendants : pagination de tous les 47.11F (Leclerc, Intermarché,
 *            Super/Hyper U, indépendants = 1 magasin / 1 SIREN → siège = magasin).
 *  Phase 2 — chaînes : balayage par département pour Carrefour / Auchan / Cora /
 *            Géant (1 SIREN = N magasins ; matching_etablissements par dept).
 *
 *  Sortie : data/hypers-fr.json  [{ enseigne, enseigneCode, ville, cp, dept,
 *           adresse, siren, tranche, effectifMin }]
 *
 *  L'API n'utilise pas le proxy en fetch → on passe par curl (child_process).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../data/hypers-fr.json");
const BASE = "https://recherche-entreprises.api.gouv.fr/search";

// Tranches INSEE → borne basse d'effectif. On EXCLUT < 50 salariés (petit hyper).
const TRANCHE_MIN = {
  "00": 0, "01": 1, "02": 3, "03": 6, "11": 10, "12": 20,
  "21": 50, "22": 100, "31": 200, "32": 250, "41": 500, "42": 1000, "51": 2000, "52": 5000, "53": 10000,
};
const MIN_EFFECTIF = 50;

const wait = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* petite pause anti rate-limit */ } };

function get(url) {
  const out = execFileSync("curl", ["-s", "--max-time", "25", url], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString("utf8"));
}

const ENSEIGNE_RULES = [
  { code: "A", label: "Auchan", re: /AUCHAN/ },
  { code: "L", label: "Leclerc", re: /LECLERC/ },
  { code: "ITM", label: "Intermarché", re: /INTERMARCHE|MOUSQUETAIRE|HYPER\s?MARCHE?\s?INTERMARCHE/ },
  { code: "CARR", label: "Carrefour", re: /CARREFOUR/ },
  { code: "U", label: "Système U", re: /HYPER\s?U|SUPER\s?U|SYSTEME\s?U|\bU\b/ },
  { code: "CORA", label: "Cora", re: /CORA/ },
  { code: "CASINO", label: "Géant/Casino", re: /GEANT|CASINO/ },
];
function classify(txt) {
  const s = (txt || "").toUpperCase();
  for (const r of ENSEIGNE_RULES) if (r.re.test(s)) return r;
  return { code: "AUTRE", label: "Indépendant / autre" };
}

const norm = (a) => (a || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const seen = new Set();
const rows = [];
function push(et, nomFallback) {
  const tr = et.tranche_effectif_salarie ?? null;
  const effMin = tr && tr in TRANCHE_MIN ? TRANCHE_MIN[tr] : null;
  if (effMin != null && effMin < MIN_EFFECTIF) return "small";
  if ((et.etat_administratif ?? "A") !== "A") return "closed";
  const cp = et.code_postal || "";
  const adresse = et.adresse || et.geo_adresse || "";
  const key = `${et.siren || ""}|${norm(adresse) || cp}`;
  if (seen.has(key)) return "dup";
  seen.add(key);
  const ensTxt = (et.liste_enseignes && et.liste_enseignes[0]) || nomFallback || "";
  const c = classify(ensTxt || nomFallback);
  rows.push({
    enseigne: ensTxt || nomFallback || "", enseigneCode: c.code, enseigneLabel: c.label,
    ville: et.libelle_commune || "", cp, dept: (cp || "").slice(0, 2), adresse,
    siren: et.siren || "", tranche: tr, effectifMin: effMin, type: "Hyper",
    proba: c.code === "AUTRE" ? "Moyenne" : (["CARR", "A", "L", "CORA", "CASINO"].includes(c.code) ? "Élevée" : "Moyenne"),
  });
  return "ok";
}

// ── Phase 1 : indépendants (pagination NAF 47.11F, on lit le siège de chaque UL).
let page = 1, pages = 1, kept = 0, small = 0;
const per = 25;
do {
  let j;
  try { j = get(`${BASE}?activite_principale=47.11F&per_page=${per}&page=${page}&minimal=true&include=siege`); }
  catch (e) { console.error("page", page, "err", e.message); wait(800); continue; }
  pages = Math.min(j.total_pages || 1, 400); // borne de sécurité
  for (const r of j.results || []) {
    // Phase 1 = indépendants uniquement (1 magasin = 1 SIREN). Les chaînes
    // (Carrefour/Auchan/Casino…) ont N établissements → leur siège n'est pas un
    // magasin : on les traite en Phase 2 (par département).
    if ((r.nombre_etablissements_ouverts || 1) > 3) continue;
    const et = r.siege || {};
    et.siren = r.siren;
    const res = push(et, r.nom_complet);
    if (res === "ok") kept++; else if (res === "small") small++;
  }
  if (page % 25 === 0) console.error(`… page ${page}/${pages} — gardés ${kept}, petits exclus ${small}`);
  page++;
  wait(120);
} while (page <= pages);

// ── Phase 2 : chaînes par département (matching_etablissements).
const DEPTS = [];
for (let d = 1; d <= 95; d++) if (d !== 20) DEPTS.push(String(d).padStart(2, "0"));
DEPTS.push("2A", "2B", "971", "972", "973", "974");
const CHAINS = ["CARREFOUR HYPERMARCHES", "AUCHAN HYPERMARCHE", "AUCHAN SUPERMARCHE", "CORA", "GEANT CASINO"];
for (const chain of CHAINS) {
  for (const dep of DEPTS) {
    let j;
    try { j = get(`${BASE}?q=${encodeURIComponent(chain)}&activite_principale=47.11F&departement=${dep}&per_page=25&page=1`); }
    catch { wait(400); continue; }
    for (const r of j.results || []) {
      for (const et of r.matching_etablissements || []) {
        et.siren = r.siren;
        push(et, r.nom_complet);
      }
    }
    wait(90);
  }
  console.error(`chaîne ${chain} balayée`);
}

writeFileSync(OUT, JSON.stringify(rows, null, 0));
const byCode = {};
for (const r of rows) byCode[r.enseigneCode] = (byCode[r.enseigneCode] || 0) + 1;
console.log(`TOTAL retenus: ${rows.length} (petits exclus: ${small}). Fichier: ${OUT}`);
console.log("Par enseigne:", JSON.stringify(byCode));
