/**
 * Prépare les fonds de carte statiques pour l'écran « Carte · Géo » du dashboard.
 *
 * Sortie (servie statiquement depuis /public/geo, fetch côté client sur l'écran
 * carte — donc HORS bundle JS) :
 *   • public/geo/fr-departements.json — départements métropolitains + Corse
 *       (props : { code, nom }). Sert de fond CHOROPLÈTHE France.
 *   • public/geo/world.json           — pays du monde (Natural Earth 110m),
 *       props réduites à { name }. Sert de fond DÉCORATIF à la carte export
 *       (les données sont des BULLES placées via lib/geo/countries.ts —
 *        le 110m ne contient pas les petits pays type Maldives).
 *
 * Les coordonnées sont arrondies à 3 décimales (~110 m) pour diviser le poids
 * par ~3 sans perte visible à l'échelle d'un dashboard.
 *
 *   Usage : node scripts/prepare-geo-assets.mjs
 *
 * Sources (licences ouvertes) :
 *   - gregoiredavid/france-geojson (départements simplifiés)
 *   - nvkelso/natural-earth-vector (ne_110m_admin_0_countries)
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "public/geo");
fs.mkdirSync(OUT, { recursive: true });

const SRC = {
  fr: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson",
  world: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
};

/** Arrondit récursivement tous les nombres d'un tableau de coordonnées. */
function roundCoords(c, dp = 3) {
  if (typeof c === "number") return Math.round(c * 10 ** dp) / 10 ** dp;
  if (Array.isArray(c)) return c.map((x) => roundCoords(x, dp));
  return c;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

async function main() {
  // ── France : départements métropolitains + Corse ──
  const fr = await fetchJson(SRC.fr);
  fr.features = fr.features.map((f) => ({
    type: "Feature",
    properties: { code: f.properties.code, nom: f.properties.nom },
    geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) },
  }));
  fs.writeFileSync(path.join(OUT, "fr-departements.json"), JSON.stringify(fr));
  console.log(`✅ fr-departements.json — ${fr.features.length} départements, ${(fs.statSync(path.join(OUT, "fr-departements.json")).size / 1024).toFixed(0)} KB`);

  // ── Monde : fond décoratif (props réduites au nom) ──
  const world = await fetchJson(SRC.world);
  world.features = world.features.map((f) => ({
    type: "Feature",
    properties: { name: f.properties.NAME_FR || f.properties.NAME || f.properties.ADMIN || "" },
    geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) },
  }));
  fs.writeFileSync(path.join(OUT, "world.json"), JSON.stringify(world));
  console.log(`✅ world.json — ${world.features.length} pays, ${(fs.statSync(path.join(OUT, "world.json")).size / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error("❌", e.message); process.exitCode = 1; });
