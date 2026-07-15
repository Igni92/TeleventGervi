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
 *
 * Onglets PAR ROUTE (deep-link conservé : chaque URL reste adressable), pastille
 * active animée — même langage visuel que ClientsSectionTabs. Rail défilant sur
 * mobile (4 onglets) pour ne jamais déborder.
 *
 * ⚠️ NE PAS afficher aux rôles TERRAIN confinés (préparateur/livreur) : proxy.ts
 * ne leur ouvre que /livraisons (+ /preparations pour le préparateur) — ils
 * naviguent via PreparateurNav. L'appelant garde cette barre derrière
 * `!isTerrainConfined(session)`.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Truck, PackageCheck, ClipboardList, PackageX } from "lucide-react";
import { SPRING } from "@/lib/motion";

const TABS = [
  { href: "/livraisons", label: "Préparation", icon: Truck },
  { href: "/details-livraison", label: "Par article", icon: PackageCheck },
  { href: "/preparations", label: "À préparer", icon: ClipboardList },
  { href: "/manquants", label: "Manquants", icon: PackageX },
] as const;

export function LivraisonsSectionTabs() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // Onglet actif par route. /livraisons est le maître (défaut) ; les 3 autres
  // routes sont distinctes (aucune n'est préfixe d'une autre).
  const activeHref =
    pathname.startsWith("/details-livraison") ? "/details-livraison"
    : pathname.startsWith("/preparations") ? "/preparations"
    : pathname.startsWith("/manquants") ? "/manquants"
    : "/livraisons";

  return (
    <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div role="tablist" aria-label="Livraisons du jour"
        className="inline-flex w-max items-center gap-1 rounded-xl border border-border bg-card p-1">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === activeHref;
          return (
            <Link
              key={href}
              href={href}
              role="tab"
              aria-selected={active}
              className={`relative inline-flex shrink-0 items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="livraisonsSectionPill"
                  transition={reduced ? { duration: 0 } : SPRING.snappy}
                  className="absolute inset-0 rounded-lg bg-secondary shadow-sm"
                  aria-hidden
                />
              )}
              <Icon className="relative h-4 w-4" />
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
