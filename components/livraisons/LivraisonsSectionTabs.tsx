"use client";

/**
 * Onglets de la section « Livraisons du jour » — les 4 vues qui lisent la MÊME
 * source (`/api/livraisons`, types `lib/livraisonView`) sont FUSIONNÉES sous une
 * seule entrée de navigation (sidebar / tuiles mobiles) et partagent cette barre
 * d'onglets :
 *   • Préparation (/livraisons)        — maître : dispatch + préparation par BL, 1 jour
 *   • Par article (/details-livraison) — même donnée pivotée par article (segments)
 *   • À préparer  (/preparations)      — BL non préparés sur 14 jours
 *   • Manquants   (/manquants)         — déficit stock par article (à acheter)
 *   • Ventes      (/ventes-du-jour)    — ventes SAISIES aujourd'hui (DocDate)
 *
 * Onglets PAR ROUTE (deep-link conservé : chaque URL reste adressable), pastille
 * active animée — même langage visuel que ClientsSectionTabs. Rail défilant sur
 * mobile (5 onglets) pour ne jamais déborder.
 *
 * ⚠️ NE PAS afficher aux rôles TERRAIN confinés (préparateur/livreur) : proxy.ts
 * ne leur ouvre que /livraisons (+ /preparations pour le préparateur) — ils
 * naviguent via PreparateurNav. L'appelant garde cette barre derrière
 * `!isTerrainConfined(session)`.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Truck, PackageCheck, ClipboardList, PackageX, Store } from "lucide-react";
import { SPRING } from "@/lib/motion";

const TABS = [
  { href: "/livraisons", label: "Préparation", icon: Truck },
  { href: "/details-livraison", label: "Par article", icon: PackageCheck },
  { href: "/preparations", label: "À préparer", icon: ClipboardList },
  { href: "/manquants", label: "Manquants", icon: PackageX },
  { href: "/ventes-du-jour", label: "Ventes", icon: Store },
] as const;

export function LivraisonsSectionTabs() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // Onglet actif par route. /livraisons est le maître (défaut) ; les 4 autres
  // routes sont distinctes (aucune n'est préfixe d'une autre).
  const activeHref =
    pathname.startsWith("/details-livraison") ? "/details-livraison"
    : pathname.startsWith("/preparations") ? "/preparations"
    : pathname.startsWith("/manquants") ? "/manquants"
    : pathname.startsWith("/ventes-du-jour") ? "/ventes-du-jour"
    : "/livraisons";

  return (
    <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Même langage que <SegmentedControl /> : creux bg-secondary, l'onglet
          actif est une pastille carte qui porte la seule ombre — plus de
          conteneur carte bordé. */}
      <div role="tablist" aria-label="Expéditions"
        className="inline-flex w-max items-stretch rounded-lg bg-secondary p-0.5">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === activeHref;
          return (
            <Link
              key={href}
              href={href}
              role="tab"
              aria-selected={active}
              className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-caption font-semibold transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="livraisonsSectionPill"
                  transition={reduced ? { duration: 0 } : SPRING.snappy}
                  className="absolute inset-0 rounded-md bg-card shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.12)]"
                  aria-hidden
                />
              )}
              <Icon className="relative h-3.5 w-3.5" />
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
