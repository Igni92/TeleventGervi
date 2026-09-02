"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  NAV_GROUPS,
  NAV_FOOTER,
  flatNavItems,
  isItemActive,
  type NavItem,
} from "@/lib/navigation";
import { useNavBadges } from "@/lib/useNavBadges";
import { GroupedList, GroupedRow } from "@/components/ui/grouped-list";
import { FullscreenPanel } from "@/components/ui/fullscreen-panel";
import { cn } from "@/lib/utils";

/**
 * Barre d'onglets BASSE — coquille TACTILE uniquement (même mécanisme
 * `md:hidden touch:!flex` que la barre du haut). Cinq entrées : les quatre
 * écrans du quotidien + « Menu », une feuille plein écran qui liste TOUTE la
 * navigation (NAV_GROUPS) en listes groupées.
 *
 * - Fixée en bas, fond card verre dépoli, filet haut hairline, padding
 *   safe-area (encoche iPhone) ;
 * - L'appelant (AppLayout) la MASQUE pour les rôles terrain confinés
 *   (préparateur restreint / livreur / agréeur → PreparateurNav) ;
 * - Rend aussi son propre ESPACEUR de flux (même visibilité) : le bas du
 *   contenu n'est jamais couvert par la barre ;
 * - Invisible à l'impression (wrapper print:hidden — un print:hidden posé sur
 *   la barre elle-même perdrait contre le `!flex` de la variante touch).
 */

/** Onglets : libellé COURT propre à la barre ; l'activité et l'icône sont
 *  reprises de l'entrée de nav correspondante (source de vérité unique). */
const TABS: { label: string; href: string; navHref: string }[] = [
  { label: "Accueil", href: "/accueil", navHref: "/accueil" },
  { label: "Console", href: "/console2", navHref: "/console" },
  { label: "Expéditions", href: "/livraisons", navHref: "/livraisons" },
  { label: "Clients", href: "/clients", navHref: "/clients" },
];

function TabButton({
  label,
  icon: Icon,
  active,
  href,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = cn(
    "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5",
    "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)]",
    "focus-visible:outline-none focus-visible:text-foreground",
    active ? "text-foreground" : "text-muted-foreground",
  );
  const inner = (
    <>
      <Icon size={22} strokeWidth={active ? 2.2 : 2} aria-hidden />
      <span className="max-w-full truncate text-caption2 font-medium">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} aria-current={active ? "page" : undefined} className={className}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

/** Contenu de la feuille « Menu » — monté SEULEMENT quand elle est ouverte
 *  (le hook de pastilles ne polle donc pas en permanence depuis la barre). */
function MenuSheetContent({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const badges = useNavBadges();

  const renderItem = (item: NavItem) => {
    const active = isItemActive(item, pathname ?? "");
    const count = item.badge ? badges[item.badge] : 0;
    const Icon = item.icon;
    return (
      <GroupedRow key={item.href} asChild>
        <Link href={item.href} onClick={onNavigate}>
          <Icon
            size={18}
            aria-hidden
            className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body",
              active ? "font-semibold text-foreground" : "text-foreground",
            )}
          >
            {item.label}
          </span>
          {count > 0 && (
            <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-caption2 font-semibold leading-none text-primary-foreground tnum">
              {count}
            </span>
          )}
        </Link>
      </GroupedRow>
    );
  };

  return (
    <div className="flex flex-col gap-5 pb-[env(safe-area-inset-bottom)]">
      {NAV_GROUPS.map((group) => (
        <GroupedList key={group.key} title={group.label}>
          {group.items.map(renderItem)}
        </GroupedList>
      ))}
      {/* Pied de nav (Paramètres) — dernière liste, sans en-tête. */}
      <GroupedList>{NAV_FOOTER.map(renderItem)}</GroupedList>
    </div>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Filet de sécurité : toute navigation referme la feuille (le clic sur une
  // rangée la ferme déjà, ceci couvre les navigations venues d'ailleurs).
  useEffect(() => setMenuOpen(false), [pathname]);

  const byHref = new Map(flatNavItems().map((item) => [item.href, item]));

  return (
    <div className="print:hidden">
      {/* Espaceur de flux — même hauteur que la barre (+ safe-area). */}
      <div
        aria-hidden
        className="hidden max-md:block touch:!block h-[calc(3.5rem+env(safe-area-inset-bottom))]"
      />
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-40 hidden max-md:flex touch:!flex items-stretch border-t border-border bg-card/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
        style={{ borderTopWidth: "var(--hairline)" }}
      >
        {TABS.map((tab) => {
          const navItem = byHref.get(tab.navHref);
          if (!navItem) return null;
          return (
            <TabButton
              key={tab.href}
              label={tab.label}
              icon={navItem.icon}
              href={tab.href}
              active={!menuOpen && isItemActive(navItem, pathname ?? "")}
            />
          );
        })}
        <TabButton
          label="Menu"
          icon={Menu}
          active={menuOpen}
          onClick={() => setMenuOpen(true)}
        />
      </nav>

      {/* Feuille plein écran : toute la navigation en listes groupées. */}
      <FullscreenPanel
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Menu"
        contentWidth="reading"
      >
        <MenuSheetContent onNavigate={() => setMenuOpen(false)} />
      </FullscreenPanel>
    </div>
  );
}
