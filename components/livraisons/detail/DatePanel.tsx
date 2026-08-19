"use client";

// EN-TÊTE FUSIONNÉ du détail livraison — le titre EST la date : « Livraison du
// mardi 19 août » (title1) + DateStepper compact (chevrons + calendrier natif
// + retour à la prochaine livraison) + mention discrète de l'état de la date.
// Remplace l'ancien empilement PageHeader + tuile camion + pastilles
// Prochaine/Date choisie. Le garde-fou férié devient un Banner warning avec
// son bouton de report intégré.
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DateStepper } from "@/components/ui/date-stepper";

/** « mardi 19 août » — sans l'année (elle n'apporte rien au quotidien ; le
 *  calendrier natif du stepper l'affiche au besoin). */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

export function DeliveryHeader({
  date, isAuto, holiday, loading, refreshing, onPick, onReset, onReport, onRefresh,
}: {
  date: string;
  /** La date affichée est la prochaine livraison calculée (J+1, samedi → J+2). */
  isAuto: boolean;
  /** Libellé du jour férié (garde-fou), ou null si jour ouvré. */
  holiday: string | null;
  /** Chargement complet en cours (premier chargement ou « Actualiser »). */
  loading: boolean;
  /** Rafraîchissement silencieux en cours (polling / retour de focus). */
  refreshing: boolean;
  onPick: (iso: string) => void;
  onReset: () => void;
  onReport: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        {/* Le titre porte la date — c'est l'information n°1 de la page. */}
        <div className="min-w-0">
          <p className="kicker mb-1.5">Télévente · logistique</p>
          <h1 className="font-display text-title2 sm:text-title1 font-bold text-foreground">
            Livraison du {dayLabel(date)}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-caption text-muted-foreground">
            {isAuto ? (
              <span>Prochaine livraison</span>
            ) : (
              <button
                type="button"
                onClick={onReset}
                className="text-brand-600 dark:text-brand-400 hover:underline"
              >
                Revenir à la prochaine livraison
              </button>
            )}
            {/* Indicateur discret du rafraîchissement automatique — jamais
                d'assombrissement global de la liste. */}
            {refreshing && !loading && (
              <span className="inline-flex items-center gap-1 text-muted-foreground/80">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Mise à jour…
              </span>
            )}
          </p>
        </div>

        {/* Stepper compact : ◀ date native ▶ (+ retour prochaine livraison). */}
        <div className="flex w-full items-center gap-1.5 sm:w-auto">
          <DateStepper value={date} onChange={onPick} className="flex-1 sm:flex-none sm:w-[236px]" />
          {!isAuto && (
            <button
              type="button"
              onClick={onReset}
              title="Revenir à la prochaine livraison"
              aria-label="Revenir à la prochaine livraison"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-brand-600 dark:hover:text-brand-400 active:scale-95"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
            className="h-10 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? "animate-spin" : ""}`} />
            <span className="max-sm:hidden">Actualiser</span>
          </Button>
        </div>
      </div>

      {/* Garde-fou jour férié — Banner warning avec le report intégré. */}
      {holiday && (
        <Banner
          tone="warning"
          title={<><b>{holiday}</b> — jour férié, pas de livraison.</>}
          action={
            <Button type="button" size="sm" variant="warning" onClick={onReport}>
              Reporter au prochain jour ouvré
            </Button>
          }
        >
          Choisissez le jour de livraison réel.
        </Banner>
      )}
    </header>
  );
}
