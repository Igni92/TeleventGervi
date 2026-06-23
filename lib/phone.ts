/**
 * Standardisation des numéros de téléphone (saisie/import souvent sales :
 * « 03. 27.99.98.97 / 65 », « +33 6 12 34 56 78 », etc.).
 *
 * Règles :
 *   - on ne garde QUE les chiffres ;
 *   - préfixe international FR ramené au format national (0033… → 33…, 33XXXXXXXXX → 0XXXXXXXXX) ;
 *   - on coupe le surplus → 10 chiffres maximum (un seul numéro).
 *
 * Exemples :
 *   "03. 27.99.98.97 / 65" → "0327999897"
 *   "+33 6 12 34 56 78"     → "0612345678"
 *   "0033327999897"         → "0332799989" (cas limite — 10 chiffres)
 */
export function standardizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0033")) d = d.slice(2);          // 0033… → 33…
  if (d.startsWith("33") && d.length >= 11) d = "0" + d.slice(2); // 33XXXXXXXXX → 0XXXXXXXXX
  return d.slice(0, 10);
}

/** Affichage groupé par 2 (01 23 45 67 89) — sur un numéro déjà standardisé. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const d = standardizePhone(raw);
  if (d.length !== 10) return d;
  return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}
