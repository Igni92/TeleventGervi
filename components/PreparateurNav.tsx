"use client";

import Link from "next/link";
import { Truck, ClipboardCheck } from "lucide-react";

/**
 * Navigation FOCALISÉE du préparateur (mobile uniquement) — accès restreint à
 * ses deux écrans de préparation. Sous `md`, la sidebar bureau est masquée et
 * le bouton « Accueil » de la barre mobile renvoie vers un écran bloqué : sans
 * ce sélecteur, le préparateur resterait piégé sur la page où il atterrit.
 * Deux onglets : « Détail livraison » (préparation de commande) ↔ « Inventaire »
 * (comptage du stock). Masqué ≥ md (la sidebar prend le relais).
 */
const TABS = [
  { href: "/livraisons", key: "livraisons", label: "Préparation livraisons", icon: Truck },
  { href: "/inventaire", key: "inventaire", label: "Inventaire", icon: ClipboardCheck },
] as const;

export function PreparateurNav({ current }: { current: "livraisons" | "inventaire" }) {
  return (
    <nav className="md:hidden mb-4 grid grid-cols-2 gap-2" aria-label="Navigation préparateur">
      {TABS.map(({ href, key, label, icon: Icon }) => {
        const active = key === current;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-[13.5px] font-semibold transition-colors active:scale-[0.98] ${
              active
                ? "border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.9} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
