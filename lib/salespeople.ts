/**
 * Commerciaux SAP (SalesPersons) ↔ comptes utilisateurs TeleVente.
 *
 * En SAP, le `SalesEmployeeName` est un trigramme (MM, JMG, AG…). On le relie
 * ici à l'email du compte applicatif correspondant. Sert à :
 *   - rattacher le « commercial assigné » d'un client (commissionné) à un user,
 *   - distinguer le **commercial** (account manager, sur le maître client) du
 *     **vendeur** (celui qui réalise la vente, sur la commande/facture).
 *
 * Les 3 commercials actifs commissionnés (cf. SAP SalesPersons) :
 *   code 1  = JMG (5 %)   code 7 = AG (5 %)   code 16 = MM
 */
export interface Salesperson {
  /** Trigramme SAP (SalesEmployeeName). */
  initials: string;
  /** SalesEmployeeCode SAP. */
  code: number;
  email: string;
  /** Patronyme SAP (pour normaliser un nom complet « Jean-Michel GUNSLAY … »). */
  surname: string;
  /** Nom complet « Prénom NOM » — affiché à la place du trigramme/acronyme. */
  fullName: string;
}

export const SALESPEOPLE: Salesperson[] = [
  { initials: "MM", code: 16, email: "m.mandine@gervifrais.com", surname: "MANDINE", fullName: "Maxyme Mandine" },
  { initials: "JMG", code: 1, email: "jm.gunslay@gervifrais.com", surname: "GUNSLAY", fullName: "Jean-Michel Gunslay" },
  { initials: "AG", code: 7, email: "m.essombe@gervifrais.com", surname: "ESSOMBE", fullName: "M. Essombe" },
];

const localPart = (email: string) => email.split("@")[0];

const BY_INITIALS = new Map(SALESPEOPLE.map((s) => [s.initials.toUpperCase(), s]));
const BY_CODE = new Map(SALESPEOPLE.map((s) => [s.code, s]));
const BY_EMAIL = new Map(SALESPEOPLE.map((s) => [s.email.toLowerCase(), s]));
const BY_LOCALPART = new Map(SALESPEOPLE.map((s) => [localPart(s.email).toLowerCase(), s]));

/** Email du compte depuis le trigramme SAP (MM/JMG/AG). */
export function emailFromInitials(initials: string | null | undefined): string | null {
  if (!initials) return null;
  return BY_INITIALS.get(initials.trim().toUpperCase())?.email ?? null;
}

/** Nom TeleVent (localPart de l'email, ex. « jm.gunslay ») depuis le trigramme. */
export function nameFromInitials(initials: string | null | undefined): string | null {
  const email = emailFromInitials(initials);
  return email ? localPart(email) : null;
}

/**
 * Normalise N'IMPORTE QUELLE représentation d'un commercial vers le **trigramme
 * canonique** (MM/JMG/AG) : trigramme, email, localPart (« jm.gunslay ») ou nom
 * SAP complet (« Jean-Michel GUNSLAY - Gervifrais »). Indispensable car les
 * écritures historiques (import SAP vs assignation manuelle) ont mélangé les
 * formats dans Client.commercial/vendeur. Renvoie la valeur d'origine nettoyée
 * si non reconnue (CM, ".", "ADM"…), pour ne jamais perdre une donnée.
 */
export function normalizeSlp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  const up = v.toUpperCase();
  if (BY_INITIALS.has(up)) return BY_INITIALS.get(up)!.initials;
  const low = v.toLowerCase();
  if (BY_EMAIL.has(low)) return BY_EMAIL.get(low)!.initials;
  if (BY_LOCALPART.has(low)) return BY_LOCALPART.get(low)!.initials;
  for (const s of SALESPEOPLE) {
    if (up.includes(s.surname)) return s.initials;
  }
  return v; // inconnu → conservé tel quel (nettoyé)
}

/**
 * Nom complet « Prénom NOM » d'un commercial depuis N'IMPORTE QUELLE
 * représentation (trigramme, email, localPart, nom SAP). Sert à remplacer
 * partout les acronymes (JMG…) par le nom lisible. Repli : si non reconnu, on
 * renvoie la valeur d'origine nettoyée (jamais de perte de donnée).
 */
export function fullNameFromSlp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = normalizeSlp(raw);
  if (!norm) return null;
  const sp = BY_INITIALS.get(norm.toUpperCase());
  return sp?.fullName ?? norm;
}

/** Trigramme SAP (MM/JMG/AG) depuis l'email du compte — repli statique quand
 *  le mapping UserCommercial n'a pas (encore) la ligne. */
export function initialsFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return BY_EMAIL.get(email.trim().toLowerCase())?.initials ?? null;
}

/** Email du compte depuis le SalesEmployeeCode SAP. */
export function emailFromSlpCode(code: number | null | undefined): string | null {
  if (code == null) return null;
  return BY_CODE.get(code)?.email ?? null;
}
