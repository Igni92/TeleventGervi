/**
 * « Voir comme » — aperçu VISUEL par rôle, réservé admin/direction.
 *
 * C'est un aperçu de CHROME (navigation + mise en page) : il ne change NI les
 * données NI les droits côté serveur. Il sert à vérifier ce que verrait un
 * Préparateur / Commercial / Direction. La logique de droits réelle reste dans
 * lib/permissions.ts (et la restriction dure du préparateur dans proxy.ts).
 */

export type PreviewRole = "preparateur" | "livreur" | "agreeur" | "commercial" | "direction";

export const PREVIEW_ROLES: PreviewRole[] = ["preparateur", "livreur", "agreeur", "commercial", "direction"];

/** Libellés FR des rôles prévisualisables. */
export const PREVIEW_ROLE_LABELS: Record<PreviewRole, string> = {
  preparateur: "Préparateur",
  livreur: "Livreur",
  agreeur: "Agréeur",
  commercial: "Commercial",
  direction: "Direction",
};

/** Type-guard : la valeur est-elle un rôle prévisualisable connu ? */
export function isPreviewRole(v: unknown): v is PreviewRole {
  return v === "preparateur" || v === "livreur" || v === "agreeur" || v === "commercial" || v === "direction";
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
  if (role === "agreeur") {
    // Périmètre de l'agréeur : le flux CF → EM (réception + agréage). Pas de
    // restriction middleware à ce jour (il peut naviguer), mais l'aperçu montre
    // son POSTE DE TRAVAIL réel.
    return href.startsWith("/commandes-fournisseurs") || href.startsWith("/entrees");
  }
  return true;
}

/** Page d'atterrissage d'un rôle (cible du « voir comme »). */
export function previewHome(role: PreviewRole): string {
  if (role === "preparateur" || role === "livreur") return "/livraisons";
  if (role === "agreeur") return "/commandes-fournisseurs";
  return "/accueil";
}

/* ─── « Voir comme {personne} » : aperçu avec TOUS ses rôles (union) ─────────── */

/** Navigation autorisée pour un ENSEMBLE de rôles (union). [] / null = vue
 *  réelle (tout visible). Sert au « voir comme {personne} » qui montre la vue
 *  GLOBALE de quelqu'un cumulant plusieurs rôles (ex. livreur + agréeur). */
export function navAllowedForRoles(href: string, roles: PreviewRole[] | null): boolean {
  if (!roles || roles.length === 0) return true;
  return roles.some((r) => navAllowedForPreview(href, r));
}

/** Logistique PURE : la personne n'a QUE des rôles terrain (prépa / livreur) →
 *  on masque les chiffres commerciaux, comme pour un rôle logistique seul. */
export function isLogisticsRoles(roles: PreviewRole[] | null): boolean {
  return !!roles && roles.length > 0 && roles.every(isLogisticsPreviewRole);
}

/** Home de l'aperçu « personne » : /accueil dès qu'un rôle « bureau »
 *  (commercial / direction) est présent, sinon le poste du 1er rôle terrain. */
export function previewHomeForRoles(roles: PreviewRole[]): string {
  if (roles.some((r) => r === "commercial" || r === "direction")) return "/accueil";
  const first = roles.find((r) => r === "preparateur" || r === "livreur" || r === "agreeur");
  return first ? previewHome(first) : "/accueil";
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
