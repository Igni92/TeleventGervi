"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Home, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Barre supérieure MOBILE — la sidebar bureau étant masquée sous `md`, cette
 * barre assure la navigation : retour accueil (lanceur en tuiles), thème et
 * compte. Visible uniquement sur petit écran (`md:hidden` posé par l'appelant).
 *
 * Anti-débordement : le conteneur est `overflow-hidden`, le titre `truncate
 * min-w-0`, et tous les boutons `shrink-0` — rien ne peut déborder, quel que
 * soit le libellé de section ou la largeur d'écran.
 */

const SECTION_LABEL: Record<string, string> = {
  "/accueil": "Accueil",
  // ⚠️ « /console2 » AVANT « /console » : le match est par préfixe (startsWith).
  "/console2": "Console 2 · Commande",
  "/console": "Console d'appels",
  "/plan-appel": "Clients & plan d'appel",
  "/clients": "Clients & plan d'appel",
  "/ventes-du-jour": "Ventes du jour",
  "/livraisons": "Livraisons du jour",
  "/details-livraison": "Livraisons · par article",
  "/preparations": "Livraisons · à préparer",
  "/manquants": "Livraisons · manquants",
  "/bons-commande": "Bons de commande",
  "/heures": "Mes heures",
  "/planning": "Planning",
  "/commerciaux": "Équipe commerciale",
  "/commandes-fournisseurs": "Commandes fournisseurs",
  "/entrees": "Entrées marchandises",
  "/inventaire": "Inventaire",
  "/products": "Stock",
  "/fabrication": "Fabrication",
  "/encours": "Encours clients",
  "/dashboard": "Statistiques",
  "/promos": "Promotions",
  "/parametres": "Paramètres",
};

export function MobileTopBar({ className }: { className?: string }) {
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const isHome = pathname === "/accueil" || pathname === "/";

  const section = Object.entries(SECTION_LABEL).find(([href]) =>
    pathname === href || (href !== "/accueil" && pathname.startsWith(href)),
  )?.[1];

  const initials = (session?.user?.name || session?.user?.email || "?")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div
      className={`sticky top-0 z-40 -mx-4 sm:-mx-10 lg:-mx-14 max-sm:!mx-0 touch:!mx-0 mb-4 overflow-hidden border-b border-border/70 bg-background/80 backdrop-blur-xl ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-5 h-14">
        {/* Retour accueil — bouton plein (marque) sur l'accueil, sobre ailleurs */}
        <Link
          href="/accueil"
          aria-label="Accueil"
          className={`inline-flex h-10 w-10 items-center justify-center rounded-xl shrink-0 transition-colors active:scale-95 ${
            isHome
              ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30"
              : "bg-secondary/70 text-foreground/70 hover:text-foreground"
          }`}
        >
          <Home className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </Link>

        {/* Titre de section — tronqué, ne déborde jamais */}
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight text-foreground">
          {section ?? "Gervi"}
        </span>


        {/* Thème — visible en clair ET en sombre (≠ toggle sidebar blanc-sur-blanc) */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-foreground/55 hover:text-foreground hover:bg-secondary/70 transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {theme === "dark" ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
        </button>

        {/* Compte */}
        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Compte"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-[12.5px] font-bold text-white shrink-0 shadow-sm active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1">
              <div className="px-3 py-2.5">
                <p className="text-[13px] font-semibold text-foreground leading-none truncate">{session.user.name}</p>
                <p className="text-[11px] text-muted-foreground mt-1 truncate">{session.user.email}</p>
              </div>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                className="text-rose-600 dark:text-rose-400 focus:text-rose-600 cursor-pointer rounded-lg text-[13px] gap-2"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-3.5 w-3.5" />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
