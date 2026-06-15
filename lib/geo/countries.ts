/**
 * Référentiel pays export — centroïde (bulle) + nom FR, clé = code ISO-2.
 *
 * La carte export est une carte à BULLES : le fond monde (public/geo/world.json,
 * Natural Earth 110m) ne contient pas les petits pays (Maldives, île Maurice…),
 * donc on place chaque destination à son centroïde issu de cette table — ce qui
 * garantit que même un micro-État apparaît.
 *
 * `resolveCountry` tolère ce que l'ERP peut stocker dans BusinessPartner.Country :
 * code ISO-2 ("MV"), ISO-3 ("MDV") ou nom en clair (FR/EN).
 */

export interface CountryGeo {
  iso2: string;
  nameFr: string;
  lat: number;
  lng: number;
}

// Centroïdes approximatifs (lat, lng) — suffisant pour des bulles à l'échelle monde.
const C: Record<string, Omit<CountryGeo, "iso2">> = {
  // ── Europe ──
  BE: { nameFr: "Belgique", lat: 50.5, lng: 4.5 },
  NL: { nameFr: "Pays-Bas", lat: 52.1, lng: 5.3 },
  LU: { nameFr: "Luxembourg", lat: 49.8, lng: 6.1 },
  DE: { nameFr: "Allemagne", lat: 51.2, lng: 10.4 },
  CH: { nameFr: "Suisse", lat: 46.8, lng: 8.2 },
  IT: { nameFr: "Italie", lat: 42.8, lng: 12.6 },
  ES: { nameFr: "Espagne", lat: 40.0, lng: -3.7 },
  PT: { nameFr: "Portugal", lat: 39.6, lng: -8.0 },
  GB: { nameFr: "Royaume-Uni", lat: 54.0, lng: -2.0 },
  IE: { nameFr: "Irlande", lat: 53.2, lng: -8.0 },
  AT: { nameFr: "Autriche", lat: 47.6, lng: 14.1 },
  DK: { nameFr: "Danemark", lat: 56.0, lng: 10.0 },
  SE: { nameFr: "Suède", lat: 62.0, lng: 15.0 },
  NO: { nameFr: "Norvège", lat: 64.0, lng: 11.0 },
  FI: { nameFr: "Finlande", lat: 64.0, lng: 26.0 },
  PL: { nameFr: "Pologne", lat: 52.1, lng: 19.4 },
  CZ: { nameFr: "Tchéquie", lat: 49.8, lng: 15.5 },
  SK: { nameFr: "Slovaquie", lat: 48.7, lng: 19.7 },
  HU: { nameFr: "Hongrie", lat: 47.2, lng: 19.5 },
  RO: { nameFr: "Roumanie", lat: 45.9, lng: 25.0 },
  BG: { nameFr: "Bulgarie", lat: 42.7, lng: 25.5 },
  GR: { nameFr: "Grèce", lat: 39.0, lng: 22.0 },
  HR: { nameFr: "Croatie", lat: 45.1, lng: 15.5 },
  SI: { nameFr: "Slovénie", lat: 46.1, lng: 14.8 },
  RS: { nameFr: "Serbie", lat: 44.0, lng: 21.0 },
  CY: { nameFr: "Chypre", lat: 35.1, lng: 33.4 },
  MT: { nameFr: "Malte", lat: 35.9, lng: 14.4 },
  IS: { nameFr: "Islande", lat: 65.0, lng: -18.0 },
  EE: { nameFr: "Estonie", lat: 58.6, lng: 25.0 },
  LV: { nameFr: "Lettonie", lat: 56.9, lng: 24.6 },
  LT: { nameFr: "Lituanie", lat: 55.2, lng: 23.9 },
  // ── Maghreb / Afrique ──
  MA: { nameFr: "Maroc", lat: 31.8, lng: -7.1 },
  DZ: { nameFr: "Algérie", lat: 28.0, lng: 2.6 },
  TN: { nameFr: "Tunisie", lat: 34.0, lng: 9.6 },
  LY: { nameFr: "Libye", lat: 27.0, lng: 17.0 },
  EG: { nameFr: "Égypte", lat: 26.8, lng: 30.8 },
  SN: { nameFr: "Sénégal", lat: 14.5, lng: -14.5 },
  CI: { nameFr: "Côte d'Ivoire", lat: 7.5, lng: -5.5 },
  CM: { nameFr: "Cameroun", lat: 5.7, lng: 12.7 },
  GA: { nameFr: "Gabon", lat: -0.8, lng: 11.6 },
  ZA: { nameFr: "Afrique du Sud", lat: -29.0, lng: 24.0 },
  MU: { nameFr: "Maurice", lat: -20.3, lng: 57.55 },
  SC: { nameFr: "Seychelles", lat: -4.6, lng: 55.5 },
  // DOM/COM français — utiles si l'ERP stocke le code territoire au lieu de "FR".
  RE: { nameFr: "La Réunion", lat: -21.13, lng: 55.53 },
  GP: { nameFr: "Guadeloupe", lat: 16.25, lng: -61.58 },
  MQ: { nameFr: "Martinique", lat: 14.64, lng: -61.02 },
  GF: { nameFr: "Guyane", lat: 3.93, lng: -53.13 },
  YT: { nameFr: "Mayotte", lat: -12.83, lng: 45.17 },
  // ── Moyen-Orient ──
  AE: { nameFr: "Émirats arabes unis", lat: 24.0, lng: 54.0 },
  SA: { nameFr: "Arabie saoudite", lat: 24.0, lng: 45.0 },
  QA: { nameFr: "Qatar", lat: 25.3, lng: 51.2 },
  KW: { nameFr: "Koweït", lat: 29.3, lng: 47.6 },
  BH: { nameFr: "Bahreïn", lat: 26.0, lng: 50.5 },
  OM: { nameFr: "Oman", lat: 21.0, lng: 57.0 },
  IL: { nameFr: "Israël", lat: 31.5, lng: 34.9 },
  LB: { nameFr: "Liban", lat: 33.9, lng: 35.9 },
  TR: { nameFr: "Turquie", lat: 39.0, lng: 35.2 },
  JO: { nameFr: "Jordanie", lat: 31.2, lng: 36.8 },
  // ── Asie (dont petits pays insulaires) ──
  MV: { nameFr: "Maldives", lat: 3.2, lng: 73.2 },
  LK: { nameFr: "Sri Lanka", lat: 7.9, lng: 80.7 },
  IN: { nameFr: "Inde", lat: 22.0, lng: 79.0 },
  CN: { nameFr: "Chine", lat: 35.0, lng: 104.0 },
  HK: { nameFr: "Hong Kong", lat: 22.3, lng: 114.2 },
  SG: { nameFr: "Singapour", lat: 1.35, lng: 103.8 },
  JP: { nameFr: "Japon", lat: 36.2, lng: 138.3 },
  KR: { nameFr: "Corée du Sud", lat: 36.5, lng: 127.8 },
  TH: { nameFr: "Thaïlande", lat: 15.0, lng: 101.0 },
  VN: { nameFr: "Viêt Nam", lat: 16.2, lng: 107.8 },
  ID: { nameFr: "Indonésie", lat: -2.5, lng: 118.0 },
  MY: { nameFr: "Malaisie", lat: 4.2, lng: 101.9 },
  // ── Amériques ──
  US: { nameFr: "États-Unis", lat: 39.8, lng: -98.6 },
  CA: { nameFr: "Canada", lat: 56.1, lng: -106.3 },
  MX: { nameFr: "Mexique", lat: 23.6, lng: -102.5 },
  BR: { nameFr: "Brésil", lat: -10.0, lng: -52.0 },
  AR: { nameFr: "Argentine", lat: -34.0, lng: -64.0 },
  // ── Outre-mer / Pacifique ──
  PF: { nameFr: "Polynésie française", lat: -17.7, lng: -149.4 },
  NC: { nameFr: "Nouvelle-Calédonie", lat: -21.3, lng: 165.5 },
  AU: { nameFr: "Australie", lat: -25.0, lng: 134.0 },
};

export const COUNTRIES: Record<string, CountryGeo> = Object.fromEntries(
  Object.entries(C).map(([iso2, v]) => [iso2, { iso2, ...v }]),
);

// ISO-3 → ISO-2 (limité aux pays connus de la table) pour tolérer un Country en 3 lettres.
const ISO3: Record<string, string> = {
  BEL: "BE", NLD: "NL", LUX: "LU", DEU: "DE", CHE: "CH", ITA: "IT", ESP: "ES",
  PRT: "PT", GBR: "GB", IRL: "IE", AUT: "AT", DNK: "DK", SWE: "SE", NOR: "NO",
  FIN: "FI", POL: "PL", CZE: "CZ", SVK: "SK", HUN: "HU", ROU: "RO", BGR: "BG",
  GRC: "GR", HRV: "HR", SVN: "SI", SRB: "RS", CYP: "CY", MLT: "MT", ISL: "IS",
  EST: "EE", LVA: "LV", LTU: "LT", MAR: "MA", DZA: "DZ", TUN: "TN", LBY: "LY",
  EGY: "EG", SEN: "SN", CIV: "CI", CMR: "CM", GAB: "GA", ZAF: "ZA", MUS: "MU",
  REU: "RE", GLP: "GP", MTQ: "MQ", GUF: "GF", MYT: "YT",
  SYC: "SC", ARE: "AE", SAU: "SA", QAT: "QA", KWT: "KW", BHR: "BH",
  OMN: "OM", ISR: "IL", LBN: "LB", TUR: "TR", JOR: "JO", MDV: "MV", LKA: "LK",
  IND: "IN", CHN: "CN", HKG: "HK", SGP: "SG", JPN: "JP", KOR: "KR", THA: "TH",
  VNM: "VN", IDN: "ID", MYS: "MY", USA: "US", CAN: "CA", MEX: "MX", BRA: "BR",
  ARG: "AR", PYF: "PF", NCL: "NC", AUS: "AU",
};

// Noms (FR/EN, en MAJUSCULES sans accent) → ISO-2, pour un Country en clair.
const NAME_TO_ISO2: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  for (const [iso2, v] of Object.entries(COUNTRIES)) m[norm(v.nameFr)] = iso2;
  // Quelques alias EN/usuels.
  Object.assign(m, {
    GERMANY: "DE", SPAIN: "ES", ITALY: "IT", BELGIUM: "BE", NETHERLANDS: "NL",
    "UNITED KINGDOM": "GB", "UK": "GB", "ENGLAND": "GB", SWITZERLAND: "CH",
    "UNITED STATES": "US", USA: "US", "UNITED ARAB EMIRATES": "AE", UAE: "AE",
    MOROCCO: "MA", ALGERIA: "DZ", TUNISIA: "TN", EGYPT: "EG", MALDIVES: "MV",
    MAURITIUS: "MU", "SAUDI ARABIA": "SA", PORTUGAL: "PT", GREECE: "GR",
    "IVORY COAST": "CI", "SOUTH AFRICA": "ZA", CHINA: "CN", JAPAN: "JP",
    SINGAPORE: "SG", "HONG KONG": "HK", INDIA: "IN",
  });
  return m;
})();

/** Résout un Country brut (ISO-2/ISO-3/nom) en pays géolocalisé, ou null. */
export function resolveCountry(raw: string | null | undefined): CountryGeo | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (COUNTRIES[up]) return COUNTRIES[up]; // ISO-2
  if (ISO3[up]) return COUNTRIES[ISO3[up]]; // ISO-3
  const byName = NAME_TO_ISO2[up.normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
  return byName ? COUNTRIES[byName] : null;
}
