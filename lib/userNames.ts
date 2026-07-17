/**
 * Nom AFFICHÉ d'un opérateur (préparateur, compteur d'inventaire, validateur…) à
 * partir de son email OU de son nom complet. Règle d'app : on n'affiche que le
 * PRÉNOM (« Hugo », « Maxyme »), jamais l'email brut — même convention que les
 * commerciaux (cf. displayNameFromSlp). Source unique côté client (aucune
 * dépendance Prisma) : complète l'annuaire des commerciaux (SALESPEOPLE) avec
 * les autres comptes (préparateurs, logistique…).
 */
import { SALESPEOPLE } from "./salespeople";

/** Comptes hors commerciaux (préparateurs, logistique…) → prénom affiché. */
const EXTRA_PEOPLE: { email: string; firstName: string }[] = [
  { email: "h.vachey@gervifrais.com", firstName: "Hugo" },
];

/** Email (minuscule) → prénom, fusion commerciaux + comptes annexes. */
const FIRST_NAME_BY_EMAIL = new Map<string, string>([
  ...SALESPEOPLE.filter((s) => s.firstName.trim()).map(
    (s) => [s.email.toLowerCase(), s.firstName.trim()] as const,
  ),
  ...EXTRA_PEOPLE.map((p) => [p.email.toLowerCase(), p.firstName] as const),
]);

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/** Forme lisible de la partie locale d'un email inconnu (« j.dupont » → « J. Dupont »). */
function fromLocalPart(localPart: string): string {
  const tokens = localPart.split(/[._-]+/).filter(Boolean);
  if (tokens.length === 0) return localPart;
  return tokens.map((t) => (t.length === 1 ? `${t.toUpperCase()}.` : cap(t))).join(" ");
}

/** Prénom (tout sauf le dernier mot) d'un nom complet (« Hugo Vachey » → « Hugo »). */
function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? fullName.trim();
  return parts.slice(0, -1).join(" ");
}

/**
 * Nom affiché (prénom) d'un opérateur depuis son email OU son nom complet :
 *   - email connu (annuaire)  → prénom (« Hugo »)
 *   - email inconnu           → partie locale lisible (« H. Vachey »)
 *   - nom complet             → prénom (tout sauf le nom de famille)
 * Renvoie "?" si la valeur est vide.
 */
export function displayPersonName(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "?";
  if (v.includes("@")) {
    const known = FIRST_NAME_BY_EMAIL.get(v.toLowerCase());
    if (known) return known;
    return fromLocalPart(v.split("@")[0]);
  }
  return firstNameOf(v);
}

/** Nom complet SANS le suffixe d'organisation (« Maxyme MANDINE - Gervifrais »
 *  → « Maxyme MANDINE ») : les comptes Microsoft portent l'entité dans leur
 *  displayName — bruit à l'écran (calendriers) comme dans les notifications. */
export function stripOrgSuffix(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s*[-–—]\s*gervifrais\s*$/i, "").trim();
}
