/**
 * Rôle PRÉPARATEUR « accès restreint » — source unique partagée entre le
 * middleware (proxy.ts, runtime Edge) et les pages serveur.
 *
 * Ces préparateurs sont VERROUILLÉS par proxy.ts sur leurs seuls écrans de
 * préparation (Détail livraison + Inventaire) ; toute autre page les renvoie
 * vers le Détail livraison. La liste est tenue ici (pas de dépendance Prisma)
 * pour rester compatible Edge et éviter la divergence middleware ↔ UI.
 *
 * ⚠️ Distinct de `isPreparateur()` (lib/inventory) qui lit le flag DB
 * `User.isPreparateur` et pilote les fonctions de GESTION de l'inventaire :
 * un admin peut porter ce flag sans être « accès restreint » ici.
 */

/** Emails (minuscule) des préparateurs à accès restreint. */
export function preparateurEmails(): string[] {
  return ["h.vachey@gervifrais.com", ...(process.env.PREPARATEUR_EMAILS || "").split(",")]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** L'utilisateur est-il un préparateur à accès restreint (verrouillé par proxy.ts) ? */
export function isRestrictedPreparateur(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return !!e && preparateurEmails().includes(e);
}
