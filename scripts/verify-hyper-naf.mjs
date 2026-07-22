/**
 * Re-classe Hyper / Super des prospects GMS-IDF via la SOURCE officielle :
 * l'activité principale INSEE de chaque SIREN (recherche-entreprises.api.gouv.fr).
 *   • NAF 47.11F  = Hypermarché  → Hyper
 *   • sinon (47.11D super, 47.11B/C/E supérette/magasin, drive, etc.) → Super
 *
 * Met à jour data/prospects-gms-idf.json (type + naf) et écrit la liste des
 * CODES à passer en Hyper (les autres → Super) pour la mise à jour en base.
 *
 * L'API n'utilise pas le proxy en fetch → curl (child_process).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../data/prospects-gms-idf.json");
const CODES_OUT = "/tmp/claude-0/gms-hyper-codes.txt";
const BASE = "https://recherche-entreprises.api.gouv.fr/search";

const wait = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
function nafOfSiren(siren) {
  try {
    const out = execFileSync("curl", ["-s", "--max-time", "20", `${BASE}?q=${siren}&per_page=5&page=1`], { maxBuffer: 32 * 1024 * 1024 });
    const j = JSON.parse(out.toString("utf8"));
    const r = (j.results || []).find((x) => x.siren === siren) || (j.results || [])[0];
    return r ? (r.activite_principale || null) : null;
  } catch { return null; }
}

const data = JSON.parse(readFileSync(SRC, "utf8"));
const sirens = [...new Set(data.map((p) => p.siren).filter(Boolean))];
const nafBySiren = new Map();
let done = 0;
for (const s of sirens) {
  nafBySiren.set(s, nafOfSiren(s));
  if (++done % 50 === 0) console.error(`… ${done}/${sirens.length}`);
  wait(110);
}

const codeOf = (p) => "PRSP" + createHash("md5").update(p.adresse || `${p.enseigne}${p.ville}`).digest("hex").slice(0, 12).toUpperCase();
const hyperCodes = new Set();
let hyper = 0, superN = 0, unknown = 0;
for (const p of data) {
  const naf = p.siren ? nafBySiren.get(p.siren) : null;
  p.naf = naf || null;
  const isHyper = naf === "47.11F";
  p.type = isHyper ? "Hyper" : "Super";
  if (naf == null) unknown++;
  if (isHyper) { hyper++; hyperCodes.add(codeOf(p)); } else superN++;
}
writeFileSync(SRC, JSON.stringify(data, null, 0));
writeFileSync(CODES_OUT, [...hyperCodes].map((c) => `'${c}'`).join(","));
console.log(`Reclassé via NAF : ${hyper} Hyper (47.11F) · ${superN} Super/autre · ${unknown} NAF inconnu (→ Super).`);
console.log(`Codes Hyper: ${hyperCodes.size} → ${CODES_OUT}`);
