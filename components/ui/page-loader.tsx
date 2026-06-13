"use client";

import { motion } from "framer-motion";

/**
 * Chargements « salle de signal » :
 *
 * - `SignalLoader`   : égaliseur 5 barres animées (écho du logo waveform).
 * - `PageLoader`     : état de chargement d'une page (utilisé par les
 *                      `loading.tsx` de chaque section — la sidebar reste
 *                      visible, le contenu affiche ce loader).
 * - `FullscreenLoader` : variante plein écran pour le cockpit /dashboard.
 *
 * Le voile grisé de NAVIGATION (clic sidebar → page suivante) vit dans
 * components/Sidebar.tsx (overlay fixed + ce SignalLoader).
 */

const BAR_HEIGHTS = [10, 17, 24, 17, 10];

export function SignalLoader({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-end gap-[3px] h-6 ${className}`}
      role="status"
      aria-label="Chargement en cours"
    >
      {BAR_HEIGHTS.map((h, i) => (
        <motion.span
          key={i}
          className="w-[3.5px] rounded-full bg-brand-500"
          style={{ height: h, transformOrigin: "bottom" }}
          animate={{ scaleY: [0.35, 1, 0.35], opacity: [0.45, 1, 0.45] }}
          transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.1, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Carte de chargement centrée — cœur commun des deux variantes. */
function LoaderChip({ label, hint }: { label?: string; hint?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex items-center gap-4 rounded-2xl border border-border bg-card/85 backdrop-blur-md px-6 py-4 shadow-2xl"
    >
      <SignalLoader />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground leading-tight">
          Chargement{label ? <span className="text-muted-foreground font-medium"> · {label}</span> : null}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{hint ?? "Récupération des données…"}</p>
      </div>
    </motion.div>
  );
}

/** Loading d'une section (rendu dans la zone de contenu, sidebar visible). */
export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="h-full min-h-[55vh] flex flex-col items-center justify-center gap-5">
      <LoaderChip label={label} />
      {/* Lignes squelettes — esquisse du contenu à venir */}
      <div className="w-72 max-w-[80vw] space-y-2.5" aria-hidden>
        <div className="h-2 rounded-full bg-foreground/[0.07] animate-pulse" />
        <div className="h-2 w-4/5 mx-auto rounded-full bg-foreground/[0.055] animate-pulse [animation-delay:150ms]" />
        <div className="h-2 w-3/5 mx-auto rounded-full bg-foreground/[0.04] animate-pulse [animation-delay:300ms]" />
      </div>
    </div>
  );
}

/** Variante plein écran (cockpit /dashboard — pas d'AppLayout). */
export function FullscreenLoader({ label }: { label?: string }) {
  return (
    <div className="h-screen w-screen flex items-center justify-center">
      <LoaderChip label={label} hint="Calcul des agrégats…" />
    </div>
  );
}
