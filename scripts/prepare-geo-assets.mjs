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
  // Base officielle des codes postaux (La Poste hexasmal) — code_postal → lat/long.
  cp: "https://www.data.gouv.fr/fr/datasets/r/dbe8a621-a9c4-4bc3-9cae-be1699c5ff25",
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

  // ── Codes postaux → coordonnées (centroïde moyen par CP) ──
  // Sert à placer chaque client en BULLE sur la carte zoomée d'un département.
  const res = await fetch(SRC.cp);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${SRC.cp}`);
  const csv = await res.text();
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(",");
  const iZip = header.indexOf("code_postal");
  const iLat = header.indexOf("latitude");
  const iLng = header.indexOf("longitude");
  const acc = new Map(); // cp → { lat, lng, n }
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const zip = c[iZip]?.trim();
    const lat = Number.parseFloat(c[iLat]);
    const lng = Number.parseFloat(c[iLng]);
    if (!zip || zip.length !== 5 || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const a = acc.get(zip) ?? { lat: 0, lng: 0, n: 0 };
    a.lat += lat; a.lng += lng; a.n += 1;
    acc.set(zip, a);
  }
  const cp = {};
  for (const [zip, a] of acc) {
    cp[zip] = [Math.round((a.lng / a.n) * 1e4) / 1e4, Math.round((a.lat / a.n) * 1e4) / 1e4];
  }
  fs.writeFileSync(path.join(OUT, "cp-fr.json"), JSON.stringify(cp));
  console.log(`✅ cp-fr.json — ${Object.keys(cp).length} codes postaux, ${(fs.statSync(path.join(OUT, "cp-fr.json")).size / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error("❌", e.message); process.exitCode = 1; });
