/**
 * Code-barres EAN-13 en SVG inline — pour l'Édition BL officielle (chaque ligne
 * article porte son code-barres, comme sur le BL SAP/coresuite).
 *
 * Module PUR (zéro dépendance, zéro DOM) : encodage standard GS1 (tables L/G/R,
 * parité pilotée par le 1er chiffre, clé de contrôle vérifiée/complétée) rendu
 * en <svg> (un <rect> par barre). Code absent ou invalide → l'appelant affiche
 * « Code is empty » (même comportement que le layout Crystal d'origine).
 */

// Tables d'encodage GS1 : 7 modules par chiffre.
const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
// Parité des 6 chiffres de gauche selon le 1er chiffre (L = L-code, G = G-code).
const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

/** Clé de contrôle EAN-13 des 12 premiers chiffres. */
export function ean13Checksum(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * Normalise un code article en EAN-13 : garde les chiffres, exige 12 ou 13
 * chiffres (12 → clé calculée ; 13 → clé vérifiée). Sinon null.
 */
export function normalizeEan13(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12) return digits + ean13Checksum(digits);
  if (digits.length === 13) {
    return ean13Checksum(digits.slice(0, 12)) === Number(digits[12]) ? digits : null;
  }
  return null;
}

/** Modules (95 bits "0"/"1") d'un EAN-13 valide de 13 chiffres. */
export function ean13Modules(ean: string): string {
  const parity = PARITY[Number(ean[0])];
  let bits = "101"; // garde gauche
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[Number(ean[i])];
  bits += "01010"; // garde centrale
  for (let i = 7; i <= 12; i++) bits += R[Number(ean[i])];
  bits += "101"; // garde droite
  return bits;
}

/**
 * SVG d'un EAN-13 (barres + chiffres « 3 540900 000078 » en dessous, comme sur
 * le BL SAP). Renvoie null si le code n'est pas un EAN-13 valide.
 */
export function ean13Svg(raw: string | null | undefined, opts?: { height?: number; module?: number }): string | null {
  const ean = normalizeEan13(raw);
  if (!ean) return null;
  const h = opts?.height ?? 26;      // hauteur des barres (px)
  const mw = opts?.module ?? 1;      // largeur d'un module (px)
  const bits = ean13Modules(ean);

  let rects = "";
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") continue;
    let w = 1;
    while (i + w < bits.length && bits[i + w] === "1") w++;
    rects += `<rect x="${i * mw}" y="0" width="${w * mw}" height="${h}" />`;
    i += w - 1;
  }

  const width = 95 * mw;
  const label = `${ean[0]} ${ean.slice(1, 7)} ${ean.slice(7)}`;
  const fontSize = 7.5 * mw;
  const totalH = h + fontSize + 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" ` +
    `viewBox="0 0 ${width} ${totalH}" role="img" aria-label="EAN ${ean}">` +
    `<g fill="#000">${rects}</g>` +
    `<text x="${width / 2}" y="${h + fontSize + 0.5}" text-anchor="middle" ` +
    `font-family="Arial, sans-serif" font-size="${fontSize}" fill="#000">${label}</text>` +
    `</svg>`
  );
}
