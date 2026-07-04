"use client";

/**
 * Onglets de la section « Clients & plan d'appel » — les deux pages sont
 * FUSIONNÉES sous une même entrée de navigation (sidebar / tuiles mobiles) et
 * partagent cette barre d'onglets. Onglets PAR ROUTE (deep-link conservé :
 * /clients et /plan-appel restent adressables), pastille active animée —
 * même langage visuel que ClientTabs (fiche client).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Users, ClipboardList } from "lucide-react";
import { SPRING } from "@/lib/motion";

const TABS = [
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/plan-appel", label: "Plan d'appel", icon: ClipboardList },
] as const;

export function ClientsSectionTabs() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // /clients, /clients/[id], /clients/new → onglet Clients ; /plan-appel → Plan d'appel.
  const activeHref = pathname.startsWith("/plan-appel") ? "/plan-appel" : "/clients";

  return (
    <div role="tablist" aria-label="Clients et plan d'appel"
      className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === activeHref;
        return (
          <Link
            key={href}
            href={href}
            role="tab"
            aria-selected={active}
            className={`relative inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold transition-colors ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {active && (
              <motion.span
                layoutId="clientsSectionPill"
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
  );
}
