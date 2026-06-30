/**
 * « Voir comme » — aperçu VISUEL par rôle, réservé admin/direction.
 *
 * C'est un aperçu de CHROME (navigation + mise en page) : il ne change NI les
 * données NI les droits côté serveur. Il sert à vérifier ce que verrait un
 * Préparateur / Commercial / Direction. La logique de droits réelle reste dans
 * lib/permissions.ts (et la restriction dure du préparateur dans proxy.ts).
 */

export type PreviewRole = "preparateur" | "commercial" | "direction";

export const PREVIEW_ROLES: PreviewRole[] = ["preparateur", "commercial", "direction"];

/** Libellés FR des rôles prévisualisables. */
export const PREVIEW_ROLE_LABELS: Record<PreviewRole, string> = {
  preparateur: "Préparateur",
  commercial: "Commercial",
  direction: "Direction",
};

/** Type-guard : la valeur est-elle un rôle prévisualisable connu ? */
export function isPreviewRole(v: unknown): v is PreviewRole {
  return v === "preparateur" || v === "commercial" || v === "direction";
}

/**
 * Un chemin de navigation est-il visible pour le rôle prévisualisé ?
 *   - `null` (vue réelle admin/direction) → tout est visible ;
 *   - préparateur → uniquement ses deux écrans (miroir de proxy.ts) ;
 *   - commercial / direction → app complète (aucune restriction visuelle à ce
 *     jour ; ce point central permettra de gater facilement si besoin).
 */
export function navAllowedForPreview(href: string, role: PreviewRole | null): boolean {
  if (!role) return true;
  if (role === "preparateur") {
    return href.startsWith("/livraisons") || href.startsWith("/inventaire");
  }
  return true;
}

/** Page d'atterrissage d'un rôle (cible du « voir comme »). */
export function previewHome(role: PreviewRole): string {
  return role === "preparateur" ? "/livraisons" : "/accueil";
}
