import type { LucideIcon } from "lucide-react";
import {
  Home, Radio, Users, Target, Truck, FileText, Package, Boxes,
  ClipboardCheck, Factory, Building2, PackageCheck, PackagePlus,
  LayoutDashboard, Trophy, Receipt, Archive, Briefcase, CalendarDays,
  Wallet, Settings, Fingerprint,
} from "lucide-react";

/**
 * SOURCE DE VÉRITÉ UNIQUE de la navigation — consommée par la Sidebar, la
 * palette de commandes (⌘K) et le lanceur mobile en tuiles. Toute entrée
 * ajoutée/retirée ici se propage d'elle-même aux trois surfaces.
 *
 * Groupes par MÉTIER, dans l'ordre du flux (vente → entrepôt → achats →
 * pilotage → RH). Les Paramètres vivent dans NAV_FOOTER (plus de groupe
 * « Système »).
 */

/** Clés de badge dynamiques — servies par GET /api/nav-badges (cf. lib/useNavBadges). */
export type NavBadgeKey = "notifications" | "offresDue" | "poDue" | "inventaire" | "incidents";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Autres préfixes de route couverts par cette entrée (entrées fusionnées :
   *  ex. « Clients & plan d'appel » reste active sur /plan-appel). */
  also?: string[];
  /** Le href principal ne matche QUE la route exacte (pas ses sous-routes) —
   *  ex. /dashboard ne doit pas rester actif sur /dashboard/magasins. */
  exactOnly?: boolean;
  /** Clé de la pastille de comptage (cf. useNavBadges). */
  badge?: NavBadgeKey;
}

export interface NavGroup {
  key: string;
  /** null = pas d'en-tête (Accueil, hors groupe, toujours en tête). */
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "accueil",
    label: null,
    items: [
      { href: "/accueil", label: "Accueil", icon: Home, badge: "notifications" },
    ],
  },
  {
    // Cœur télévente — le quotidien du commercial.
    key: "televente",
    label: "Télévente",
    items: [
      // FUSION des deux anciennes entrées console : une seule entrée qui couvre
      // la console d'appels (/console, exact-only : ses sous-routes gardent
      // leur vie propre) et la console de commande (/console/ecran2, /console2).
      { href: "/console", label: "Console télévente", icon: Radio, exactOnly: true, also: ["/console/ecran2", "/console2"] },
      // Clients & plan d'appel FUSIONNÉS : une seule entrée, onglets in-page.
      { href: "/clients", label: "Clients & plan d'appel", icon: Users, also: ["/plan-appel"] },
      { href: "/prospection", label: "Prospection", icon: Target },
    ],
  },
  {
    // Entrepôt — la marchandise qui sort (préparation) + ce qu'on a en rayon.
    key: "entrepot",
    label: "Entrepôt",
    items: [
      // « Livraisons du jour » — HUB à onglets in-page (Préparation · Par article ·
      // À préparer · Manquants · Ventes) : routes secondaires en `also`.
      { href: "/livraisons", label: "Expéditions", icon: Truck, also: ["/details-livraison", "/preparations", "/manquants", "/ventes-du-jour"] },
      { href: "/bons-commande", label: "Bons de commande", icon: FileText, badge: "offresDue" },
      { href: "/products", label: "Stock", icon: Package },
      { href: "/articles", label: "Articles", icon: Boxes },
      { href: "/inventaire", label: "Inventaire", icon: ClipboardCheck, badge: "inventaire" },
      { href: "/fabrication", label: "Fabrication", icon: Factory },
    ],
  },
  {
    // Achats — le flux CF → EM (poste acheteur / agréeur).
    key: "achats",
    label: "Achats",
    items: [
      { href: "/fournisseurs", label: "Fournisseurs", icon: Building2 },
      { href: "/commandes-fournisseurs", label: "Cde Fournisseur", icon: PackageCheck, badge: "poDue" },
      { href: "/entrees", label: "Entrées marchandises", icon: PackagePlus, badge: "incidents" },
    ],
  },
  {
    // Pilotage — CHIFFRABLE : statistiques, résultats, finance.
    key: "pilotage",
    label: "Pilotage",
    items: [
      { href: "/dashboard", label: "Statistiques", icon: LayoutDashboard, exactOnly: true },
      { href: "/dashboard/magasins", label: "Palmarès magasins", icon: Trophy },
      { href: "/encours", label: "Encours", icon: Receipt },
      { href: "/etat-documentaire", label: "État documentaire", icon: Archive },
      { href: "/transport", label: "Coût de transport", icon: Truck },
    ],
  },
  {
    // Ressources humaines — L'HUMAIN : effectif, présence/congés, paie.
    key: "rh",
    label: "RH",
    items: [
      { href: "/rh", label: "Mon espace (badgeuse)", icon: Fingerprint },
      { href: "/rh/direction", label: "Cockpit RH", icon: LayoutDashboard },
      { href: "/commerciaux", label: "Effectif", icon: Briefcase },
      { href: "/planning", label: "Planning", icon: CalendarDays },
      { href: "/salaires", label: "Éléments de salaires", icon: Wallet },
    ],
  },
];

/** Entrées de pied de barre — hors groupes (l'ancien groupe « Système »). */
export const NAV_FOOTER: NavItem[] = [
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

/** Toutes les entrées des groupes, à plat (sans NAV_FOOTER). */
export function flatNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items);
}

/** Un href matche-t-il le pathname ? Exact, accueil ≡ /, sinon préfixe
 *  (sauf exactOnly : /dashboard et /console ne « couvrent » pas leurs sous-routes). */
function hrefMatches(href: string, pathname: string, exactOnly?: boolean): boolean {
  if (pathname === href) return true;
  if (href === "/accueil" && pathname === "/") return true;
  if (exactOnly) return false;
  return pathname.startsWith(href);
}

/** Item actif — href principal (exactOnly respecté) OU une de ses routes
 *  secondaires `also` (toujours en préfixe : elles couvrent leurs sous-routes). */
export function isItemActive(item: NavItem, pathname: string): boolean {
  return (
    hrefMatches(item.href, pathname, item.exactOnly) ||
    (item.also ?? []).some((h) => hrefMatches(h, pathname))
  );
}
