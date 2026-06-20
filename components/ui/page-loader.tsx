/**
 * Chargements « salle de signal ».
 *
 * - `SignalLoader`   : égaliseur 5 barres — animé en CSS PUR (transform/opacity
 *                      = thread compositeur) pour rester FLUIDE même quand le
 *                      thread principal est occupé à rendre la page. (Avant :
 *                      framer-motion → saccadait pendant les gros rendus.)
 * - `PageLoader`     : état de chargement d'une section (sidebar visible).
 * - `FullscreenLoader` : variante plein écran (cockpit /dashboard).
 *
 * Le voile de NAVIGATION (clic sidebar) vit dans components/Sidebar.tsx.
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
        <span
          key={i}
          className="signal-bar w-[3.5px] rounded-full bg-brand-500"
          style={{ height: h, animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}

/** Carte de chargement centrée — cœur commun des deux variantes.
 *  Fond OPAQUE (pas de backdrop-filter) : moins cher à peindre pendant le
 *  chargement, et pas d'animation d'entrée JS. */
function LoaderChip({ label, hint }: { label?: string; hint?: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card px-6 py-4 shadow-2xl">
      <SignalLoader />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground leading-tight">
          Chargement{label ? <span className="text-muted-foreground font-medium"> · {label}</span> : null}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{hint ?? "Récupération des données…"}</p>
      </div>
    </div>
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
