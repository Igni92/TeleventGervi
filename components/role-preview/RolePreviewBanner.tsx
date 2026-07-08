"use client";

import { Eye, X } from "lucide-react";
import { useRolePreview } from "./RolePreviewProvider";

/**
 * Bandeau d'aperçu — visible UNIQUEMENT quand un aperçu est actif. Rappelle en
 * permanence que l'on regarde l'app « comme » quelqu'un (et que les données
 * restent celles du compte réel), avec une sortie d'aperçu en un clic.
 */
export function RolePreviewBanner() {
  const { previewLabel, clearPreview } = useRolePreview();
  if (!previewLabel) return null;

  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <Eye className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-tight">
        Aperçu <b>{previewLabel}</b> — vous voyez la navigation telle qu&apos;il la
        verrait. <span className="text-amber-700/80 dark:text-amber-300/70">Les données restent les vôtres.</span>
      </p>
      <button
        onClick={clearPreview}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-[12px] font-semibold hover:bg-amber-500/25 transition-colors"
      >
        <X className="h-3.5 w-3.5" /> Quitter l&apos;aperçu
      </button>
    </div>
  );
}
