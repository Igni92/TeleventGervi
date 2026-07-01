/**
 * « Voir comme » — aperçu VISUEL par rôle, réservé admin/direction.
 *
 * C'est un aperçu de CHROME (navigation + mise en page) : il ne change NI les
 * données NI les droits côté serveur. Il sert à vérifier ce que verrait un
 * Préparateur / Commercial / Direction. La logique de droits réelle reste dans
 * lib/permissions.ts (et la restriction dure du préparateur dans proxy.ts).
 */

export type PreviewRole = "preparateur" | "livreur" | "commercial" | "direction";

export const PREVIEW_ROLES: PreviewRole[] = ["preparateur", "livreur", "commercial", "direction"];

/** Libellés FR des rôles prévisualisables. */
export const PREVIEW_ROLE_LABELS: Record<PreviewRole, string> = {
  preparateur: "Préparateur",
  livreur: "Livreur",
  commercial: "Commercial",
  direction: "Direction",
};

/** Type-guard : la valeur est-elle un rôle prévisualisable connu ? */
export function isPreviewRole(v: unknown): v is PreviewRole {
  return v === "preparateur" || v === "livreur" || v === "commercial" || v === "direction";
}

/**
 * Un chemin de navigation est-il visible pour le rôle prévisualisé ?
 *   - `null` (vue réelle admin/direction) → tout est visible ;
 *   - Effectifs (/commerciaux) → TOUJOURS visible : c'est le poste de pilotage de
 *     l'aperçu (« voir comme » + retour « vue réelle »), donc la porte de sortie ;
 *   - préparateur → ses deux écrans (miroir de proxy.ts) ;
 *   - livreur → livraison + fiches clients (miroir de proxy.ts) ;
 *   - commercial / direction → app complète (aucune restriction visuelle à ce jour).
 */
export function navAllowedForPreview(href: string, role: PreviewRole | null): boolean {
  if (!role) return true;
  if (href.startsWith("/commerciaux")) return true;   // porte de sortie de l'aperçu
  if (role === "preparateur") {
    return href.startsWith("/livraisons") || href.startsWith("/inventaire");
  }
  if (role === "livreur") {
    return href.startsWith("/livraisons") || href.startsWith("/clients");
  }
  return true;
}

/** Page d'atterrissage d'un rôle (cible du « voir comme »). */
export function previewHome(role: PreviewRole): string {
  return role === "preparateur" || role === "livreur" ? "/livraisons" : "/accueil";
}

/**
 * Rôles « terrain logistique » (préparateur, livreur) : leur périmètre se borne
 * à la logistique. Dans l'aperçu on masque donc, pour eux :
 *   - les onglets Commercial & Comptabilité de la fiche client → Logistique seule ;
 *   - les chiffres des commerciaux (CA / marge / prime) de l'écran Effectifs.
 * Aperçu VISUEL uniquement : les droits réels restent côté serveur.
 */
export function isLogisticsPreviewRole(role: PreviewRole | null): boolean {
  return role === "preparateur" || role === "livreur";
}
