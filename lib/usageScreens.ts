/**
 * Libellé humain d'un ÉCRAN à partir de sa route (pathname).
 *
 * Sert à l'analytique d'usage (UsageScreenView.screen) pour lire les rapports
 * en clair (« Console d'appels » plutôt que « /console »). Isolé ici (pas de
 * dépendance React) pour être utilisable côté client (UsageTracker) comme côté
 * serveur (route d'ingestion, scripts d'audit).
 *
 * On mappe par PRÉFIXE, du plus spécifique au plus générique — l'ordre compte.
 * Les libellés suivent la navigation (cf. components/Sidebar NAV_GROUPS).
 */

const SCREEN_PREFIXES: [string, string][] = [
  // Télévente
  ["/console/ecran2", "Console de commande"],
  ["/console2", "Console de commande"],
  ["/console", "Console d'appels"],
  ["/plan-appel", "Plan d'appel"],
  ["/clients", "Clients & plan d'appel"],
  ["/ventes-du-jour", "Ventes du jour"],
  // Entrepôt
  ["/livraisons", "Livraisons du jour"],
  ["/details-livraison", "Livraisons — par article"],
  ["/preparations", "Livraisons — à préparer"],
  ["/manquants", "Livraisons — manquants"],
  ["/bons-commande", "Bons de commande"],
  ["/bons-preparation", "Bons de préparation"],
  ["/products", "Stock"],
  ["/articles", "Articles"],
  ["/inventaire", "Inventaire"],
  ["/fabrication", "Fabrication"],
  ["/production", "Production"],
  // Achats
  ["/fournisseurs", "Fournisseurs"],
  ["/commandes-fournisseurs", "Commandes fournisseurs"],
  ["/entrees", "Entrées marchandises"],
  // Pilotage
  ["/dashboard/magasins", "Palmarès magasins"],
  ["/dashboard", "Statistiques"],
  ["/encours", "Encours clients"],
  ["/commerciaux", "Effectif"],
  ["/planning", "Planning congés"],
  ["/salaires", "Éléments de salaires"],
  ["/transport", "Coût de transport"],
  ["/heures", "Heures"],
  ["/promos", "Promotions"],
  // Système / divers
  ["/parametres", "Paramètres"],
  ["/accueil", "Accueil"],
  ["/login", "Connexion"],
];

/** Libellé lisible d'un écran depuis sa route. Repli : la route elle-même. */
export function screenLabel(pathname: string | null | undefined): string {
  if (!pathname) return "—";
  const path = pathname.split("?")[0].split("#")[0];
  if (path === "/" ) return "Accueil";
  for (const [prefix, label] of SCREEN_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix)) {
      return label;
    }
  }
  return path;
}
