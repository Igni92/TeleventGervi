"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Home, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
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
 */

const SECTION_LABEL: Record<string, string> = {
  "/accueil": "Accueil",
  "/console": "Console",
  "/plan-appel": "Plan d'appel",
  "/clients": "Clients",
  "/commerciaux": "Commerciaux",
  "/entrees": "Entrées marchandises",
  "/products": "Stock",
  "/fabrication": "Fabrication",
  "/encours": "Encours",
  "/dashboard": "Statistiques",
  "/promos": "Promotions",
  "/parametres": "Paramètres",
};

export function MobileTopBar({ className }: { className?: string }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const isHome = pathname === "/accueil" || pathname === "/";

  const section = Object.entries(SECTION_LABEL).find(([href]) =>
    pathname === href || (href !== "/accueil" && pathname.startsWith(href)),
  )?.[1];

  const initials = (session?.user?.name || session?.user?.email || "?")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className={`sticky top-0 z-40 -mx-4 sm:-mx-10 mb-4 flex items-center gap-2.5 border-b border-border bg-background/85 px-4 sm:px-6 py-2 backdrop-blur ${className ?? ""}`}>
      <Link
        href="/accueil"
        aria-label="Accueil"
        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border shrink-0 ${isHome ? "bg-brand-500/10 text-brand-600 dark:text-brand-400" : "text-foreground/70"}`}
      >
        <Home className="h-5 w-5" />
      </Link>

      <span className="min-w-0 flex-1 block text-[17px] font-semibold text-foreground truncate leading-tight">
        {section ?? "TeleVent"}
      </span>

      <ThemeToggle />

      {session?.user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Compte"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-600 text-[13px] font-bold text-white shrink-0"
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
  );
}
