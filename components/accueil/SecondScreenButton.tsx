"use client";

import { ExternalLink } from "lucide-react";

/**
 * Gros bouton ACCUEIL « 2ᵉ écran » : ouvre un autre onglet TeleVent (nouvel
 * onglet navigateur) pour que l'utilisateur principal (âgé) bascule facilement
 * entre ses 2 écrans. Cible modifiable en une ligne (`SECOND_SCREEN`).
 */
const SECOND_SCREEN = "/console";

export function SecondScreenButton() {
  return (
    <a
      href={SECOND_SCREEN}
      target="_blank"
      rel="noopener"
      className="inline-flex shrink-0 items-center justify-center gap-2.5 rounded-2xl border-2 border-brand-500/40 bg-brand-500/10 px-5 py-3 text-brand-700 dark:text-brand-300 shadow-card transition-colors hover:bg-brand-500/20 active:scale-[0.99]"
    >
      <ExternalLink className="h-6 w-6 shrink-0" />
      <span className="text-[16px] font-bold leading-tight whitespace-nowrap">2ᵉ écran</span>
    </a>
  );
}
