"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Home, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { flatNavItems, isItemActive, NAV_FOOTER } from "@/lib/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Barre supérieure MOBILE — la sidebar bureau étant masquée sous `md`, cette
 * barre assure la navigation : retour accueil, thème et compte. Visible
 * uniquement en coquille tactile (`md:hidden touch:!block` posé par l'appelant).
 *
 * Le titre de section est DÉRIVÉ de la source de vérité navigation
 * (lib/navigation) — plus de table locale à maintenir : une entrée
 * ajoutée/renommée dans NAV_GROUPS se propage d'elle-même ici.
 *
 * Anti-débordement : le conteneur est `overflow-hidden`, le titre `truncate
 * min-w-0`, et tous les boutons `shrink-0` — rien ne peut déborder, quel que
 * soit le libellé de section ou la largeur d'écran.
 */
export function MobileTopBar({ className }: { className?: string }) {
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const isHome = pathname === "/accueil" || pathname === "/";

  // Titre = libellé de l'entrée de nav active (groupes puis pied de barre).
  // Routes hors nav (ex. /heures) → repli sur la marque.
  const section = [...flatNavItems(), ...NAV_FOOTER].find((item) =>
    isItemActive(item, pathname ?? ""),
  )?.label;

  const initials = (session?.user?.name || session?.user?.email || "?")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div
      className={`sticky top-0 z-40 -mx-4 sm:-mx-10 lg:-mx-14 mb-4 overflow-hidden border-b border-border/70 bg-background/80 backdrop-blur-xl print:hidden ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-5 h-14">
        {/* Retour accueil — bouton plein (marque) sur l'accueil, sobre ailleurs */}
        <Link
          href="/accueil"
          aria-label="Accueil"
          className={`inline-flex h-10 w-10 items-center justify-center rounded-xl shrink-0 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] active:scale-95 ${
            isHome
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-secondary/70 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Home className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </Link>

        {/* Titre de section — tronqué, ne déborde jamais */}
        <span className="min-w-0 flex-1 truncate text-title3 font-semibold text-foreground">
          {section ?? "Gervi"}
        </span>

        {/* Thème — visible en clair ET en sombre (≠ toggle sidebar blanc-sur-blanc) */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors duration-[var(--dur-fast)] shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {theme === "dark" ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
        </button>

        {/* Compte */}
        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Compte"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-caption font-bold text-primary-foreground shrink-0 shadow-sm active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1">
              <div className="px-3 py-2.5">
                <p className="text-body font-semibold text-foreground leading-none truncate">{session.user.name}</p>
                <p className="text-caption2 text-muted-foreground mt-1 truncate">{session.user.email}</p>
              </div>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer rounded-lg text-body gap-2"
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
