"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Truck, ClipboardCheck, PackageCheck, PackagePlus, Clock3, type LucideIcon } from "lucide-react";
import { isRestrictedPreparateur } from "@/lib/preparateur";

/**
 * Navigation FOCALISÉE des rôles TERRAIN (mobile uniquement) — préparateur
 * restreint / livreur / agréeur confinés par le middleware (proxy.ts). Sous
 * `md`, la sidebar bureau est masquée et le bouton « Accueil » de la barre
 * mobile renvoie vers un écran bloqué : sans ce sélecteur, l'utilisateur
 * resterait piégé sur la page où il atterrit.
 *
 * Onglets affichés selon les rôles réels (lus dans la session) :
 *   • toujours   : Préparation livraisons, Inventaire, Mes heures
 *   • agréeur    : + Commandes fournisseurs, Entrées marchandises
 * Masqué ≥ md (la sidebar prend le relais).
 */
type TabKey = "livraisons" | "inventaire" | "commandes-fournisseurs" | "entrees" | "heures";
interface Tab { href: string; key: TabKey; label: string; icon: LucideIcon }

const BASE_TABS: Tab[] = [
  { href: "/livraisons", key: "livraisons", label: "Préparation", icon: Truck },
  { href: "/inventaire", key: "inventaire", label: "Inventaire", icon: ClipboardCheck },
];
const AGREEUR_TABS: Tab[] = [
  { href: "/commandes-fournisseurs", key: "commandes-fournisseurs", label: "Cdes fourn.", icon: PackageCheck },
  { href: "/entrees", key: "entrees", label: "Entrées march.", icon: PackagePlus },
];
const HEURES_TAB: Tab = { href: "/heures", key: "heures", label: "Mes heures", icon: Clock3 };

export function PreparateurNav({ current }: { current: TabKey }) {
  const { data: session } = useSession();
  // L'agréeur (flag jeton) voit en plus le flux CF → EM. isRestrictedPreparateur
  // est email-only : la nav n'est de toute façon rendue que pour un rôle terrain.
  const isAgreeur = session?.user?.isAgreeur === true;
  const restricted = isRestrictedPreparateur(session?.user?.email);
  const isLivreur = session?.user?.isLivreur === true;

  const tabs: Tab[] = [
    // Le livreur « pur » (ni préparateur ni agréeur) n'a pas d'écran inventaire —
    // on garde néanmoins Préparation + Mes heures, ses écrans utiles.
    ...(restricted ? BASE_TABS : BASE_TABS.filter((t) => t.key === "livraisons")),
    ...(isAgreeur ? AGREEUR_TABS : []),
    HEURES_TAB,
  ];
  // Livreur non préparateur : garde aussi l'accès Clients ? Non — géré par la
  // sidebar/tuiles ; ici on reste sur les écrans de la nav focalisée.
  void isLivreur;

  return (
    <nav className="md:hidden mb-4 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Navigation terrain">
      {tabs.map(({ href, key, label, icon: Icon }) => {
        const active = key === current;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-semibold transition-colors active:scale-[0.98] ${
              active
                ? "border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.9} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
