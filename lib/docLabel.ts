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

/**
 * Référence signée d'une pièce SAP, format « TYPE N° - initiales à heure » :
 *   « CF 2709 - JMG à 13h10 », « EM 22350 - MM à 14h30 », « BL N°24015045 - MM à 9h05 ».
 *
 * Le numéro de la pièce n'est connu qu'APRÈS création côté SAP → on appelle
 * `docRef` une 1re fois sans `docNum` (référence provisoire posée à la création),
 * puis une 2e fois AVEC `docNum` pour un PATCH qui grave le numéro définitif.
 *
 * `numSign` ajoute « N° » devant le numéro (usage : bon de livraison). `note`
 * (commentaire libre / mention promo) est préservée en suffixe après « · ».
 */
export function docRef(opts: {
  prefix: string;
  docNum?: number | string | null;
  name?: string | null;
  email?: string | null;
  heure?: string | null;
  numSign?: boolean;
  note?: string | null;
}): string {
  const ini = userInitials(opts.name, opts.email);
  const num = opts.docNum != null && opts.docNum !== "" ? ` ${opts.numSign ? "N°" : ""}${opts.docNum}` : "";
  const base = `${opts.prefix}${num} - ${ini}${opts.heure ? ` à ${opts.heure}` : ""}`;
  const note = opts.note?.trim();
  return note ? `${base} · ${note}` : base;
}

/**
 * Heure « HHhMM » extraite d'une référence signée (l'inverse de `docRef`) :
 * « EM 22350 - MM à 14h30 · réception CF 2709 » → « 14h30 ».
 *
 * La signature précède la note libre → on prend la PREMIÈRE occurrence après
 * « à » (une note contenant elle-même une heure ne pollue pas). Repli sur la
 * dernière heure trouvée pour l'ancien format (« … · Commande à 13h10 »).
 */
export function heureFromRef(comments?: string | null): string | null {
  if (!comments) return null;
  const signed = comments.match(/à\s+(\d{1,2}h\d{2})/);
  if (signed) return signed[1];
  const all = comments.match(/\d{1,2}h\d{2}/g);
  return all ? all[all.length - 1] : null;
}
