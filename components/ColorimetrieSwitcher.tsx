"use client";

import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Sélecteur de COLORIMÉTRIE — bascule l'accent de l'app à chaud.
 * Pose `data-theme` sur <html> (lu par les surcharges CSS dans globals.css)
 * et persiste le choix dans localStorage. Le fond anthracite et les couleurs
 * sémantiques (erreur/avert./succès) ne changent pas.
 *
 * L'anti-FOUC (application avant le 1er paint) est géré par un petit script
 * inline dans app/layout.tsx — ici on ne fait que l'UI + la persistance.
 */
const STORAGE_KEY = "televent-theme";

const THEMES = [
  { id: "or",     label: "Or",     hint: "Classique",        color: "#facc15" },
  { id: "agrume", label: "Agrume", hint: "Peps · conseillé", color: "#f97316" },
  { id: "fraise", label: "Fraise", hint: "Peps max",         color: "#f43f5e" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

export function ColorimetrieSwitcher() {
  const [theme, setTheme] = useState<ThemeId>("or");

  // Lit le thème déjà appliqué (par le script anti-FOUC) ou le storage.
  useEffect(() => {
    const fromAttr = document.documentElement.getAttribute("data-theme");
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
    const initial = (fromAttr || saved || "or") as ThemeId;
    setTheme(THEMES.some((t) => t.id === initial) ? initial : "or");
  }, []);

  const apply = (id: ThemeId) => {
    setTheme(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
    if (id === "or") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", id);
  };

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={`Colorimétrie : ${current.label}`}
          aria-label="Changer la colorimétrie"
          className="inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-white/60 hover:text-white/90 hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
        >
          <span className="h-3 w-3 rounded-full ring-1 ring-white/20" style={{ background: current.color }} />
          <Palette className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 mt-2 rounded-xl bg-white dark:bg-[#16181f] border-white/[0.08] shadow-modal p-1">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Colorimétrie
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="dark:bg-white/[0.06]" />
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => apply(t.id)}
            className="cursor-pointer rounded-lg gap-2.5 text-[13px]"
          >
            <span className="h-4 w-4 rounded-full ring-1 ring-black/10 dark:ring-white/15 shrink-0" style={{ background: t.color }} />
            <span className="font-medium">{t.label}</span>
            <span className="text-[11px] text-muted-foreground">{t.hint}</span>
            {theme === t.id && <Check className="h-3.5 w-3.5 ml-auto text-brand-500" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
