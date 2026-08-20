"use client";

/**
 * Onglets de la section TÉLÉVENTE — les deux écrans de la console sont
 * FUSIONNÉS sous une seule entrée de navigation (« Console télévente »,
 * lib/navigation.ts) et basculent via cette barre :
 *   • Appels   (/console)        — Écran 1 : file d'appel + fiche client active
 *   • Commande (/console/ecran2) — Écran 2 : prise de commande depuis le stock
 *
 * Les deux écrans restent synchronisés via consoleSync (le client actif de la
 * file est diffusé à l'écran 2). Même langage visuel que LivraisonsSectionTabs :
 * creux bg-secondary, pastille active animée, deep-link par route conservé.
 *
 * La version mobile allégée (/console2, MobileConsole2) reste une route à part,
 * atteinte par la coquille tactile — pas exposée dans cette barre desktop.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Radio, FileText } from "lucide-react";
import { SPRING } from "@/lib/motion";

const TABS = [
  { href: "/console", label: "Appels", icon: Radio },
  { href: "/console/ecran2", label: "Commande", icon: FileText },
] as const;

export function ConsoleSectionTabs() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // /console/ecran2 est une sous-route de /console : on teste donc le cas le
  // plus spécifique d'abord.
  const activeHref = pathname.startsWith("/console/ecran2") ? "/console/ecran2" : "/console";

  return (
    <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        role="tablist"
        aria-label="Console télévente"
        className="inline-flex w-max items-stretch rounded-lg bg-secondary p-0.5"
      >
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
                  layoutId="consoleSectionPill"
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
