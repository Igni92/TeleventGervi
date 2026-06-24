/**
 * Initiales de l'utilisateur connecté pour signer les documents SAP.
 * « Maxyme MANDINE - Gervifrais » → « MM ». On prend la 1re lettre des deux
 * premiers mots (hors séparateurs), en MAJUSCULES.
 */
export function userInitials(name?: string | null, email?: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "??";
  const words = src.split(/[\s.@_-]+/).filter(Boolean);
  const ini = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return ini || "??";
}

/** Libellé court signé pour un type de document SAP : « EM - Televent : MM ». */
export function docLabel(prefix: string, name?: string | null, email?: string | null): string {
  return `${prefix} - Televent : ${userInitials(name, email)}`;
}
