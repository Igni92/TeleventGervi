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
}

export const SALESPEOPLE: Salesperson[] = [
  { initials: "MM", code: 16, email: "m.mandine@gervifrais.com" },
  { initials: "JMG", code: 1, email: "jm.gunslay@gervifrais.com" },
  { initials: "AG", code: 7, email: "m.essombe@gervifrais.com" },
];

const BY_INITIALS = new Map(SALESPEOPLE.map((s) => [s.initials.toUpperCase(), s]));
const BY_CODE = new Map(SALESPEOPLE.map((s) => [s.code, s]));
const BY_EMAIL = new Map(SALESPEOPLE.map((s) => [s.email.toLowerCase(), s]));

/** Email du compte depuis le trigramme SAP (MM/JMG/AG). */
export function emailFromInitials(initials: string | null | undefined): string | null {
  if (!initials) return null;
  return BY_INITIALS.get(initials.trim().toUpperCase())?.email ?? null;
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
