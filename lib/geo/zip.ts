/**
 * Géolocalisation « métier » à partir des champs adresse du miroir client
 * (Client.zipCode / Client.country, alimentés par l'import SAP — cf.
 * /api/sap/clients/import). Pas de géocodage externe : on déduit la zone de
 * livraison du code postal (France) ou du pays (export).
 *
 * Robustesse : les champs SAP sont saisis à la main côté ERP → on tolère les
 * variations (espaces, casse, code postal noyé dans une chaîne, pays en code
 * ISO-2/3 ou en clair FR/EN).
 */

/** Extrait un code postal français (5 chiffres) d'une chaîne libre. */
export function extractFrenchZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

/**
 * Code département à partir d'un code postal FR.
 *   • DOM/COM : "97x" / "98x" → 3 premiers chiffres (971 Guadeloupe…).
 *   • Corse   : "20xxx" → 2A (Corse-du-Sud, < 20200) ou 2B (Haute-Corse).
 *   • Sinon   : 2 premiers chiffres ("01".."95").
 * Renvoie null si pas un code postal exploitable.
 */
export function departementOfZip(zip: string | null | undefined): string | null {
  const z = extractFrenchZip(zip) ?? (zip ? String(zip).replace(/\D/g, "") : "");
  if (!z || z.length < 2) return null;
  const two = z.slice(0, 2);
  if (two === "97" || two === "98") return z.slice(0, 3);
  if (two === "20") {
    const n = Number.parseInt(z.slice(0, 5).padEnd(5, "0"), 10);
    return n < 20200 ? "2A" : "2B";
  }
  return two;
}

const FRANCE_TOKENS = new Set([
  "", "FR", "FRA", "FRANCE", "FRANCIA", "FRANKREICH", "FR-FR", "250",
]);

/**
 * Le client est-il livré en FRANCE (métropole + DOM) ? Un pays vide vaut France
 * (cas le plus fréquent dans l'ERP : le pays n'est renseigné que pour l'export).
 */
export function isFranceCountry(country: string | null | undefined): boolean {
  return FRANCE_TOKENS.has(String(country ?? "").trim().toUpperCase());
}
