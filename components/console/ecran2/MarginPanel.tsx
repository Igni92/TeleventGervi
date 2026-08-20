"use client";

import { Eye, EyeOff, Truck, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import type { PositionCostDetail } from "@/lib/carrierTariff";

/**
 * Panneau MARGE de la commande (pied de la colonne « Commande »).
 * RÉDUIT par défaut à UNE ligne : point feu-tricolore (rouge = à perte, ambre
 * < 10 %, vert ≥ 10 %) + « Marge nette 42,3 € · 12,4 % » + œil (masquage). Le
 * DÉTAIL (coût transport, marge brute, bascule /livraison ↔ /kg) vit dans un
 * popover ouvert au clic sur la ligne. Le garde d'affichage reste chez l'appelant.
 */
export function MarginPanel({
  netTone, hasCostData, hasKgData, marginUnit, setMarginUnit, hideMargin, toggleHideMargin,
  transportPerKgClient, carrierIsDirect, coutTransportTotal, positionCost,
  margeBruteTotal, margeBruteKg, margeNetteTotal, margeNetteKg, margeNettePct,
}: {
  netTone: "rose" | "amber" | "emerald";
  hasCostData: boolean;
  hasKgData: boolean;
  marginUnit: "position" | "kg";
  setMarginUnit: (u: "position" | "kg") => void;
  hideMargin: boolean;
  toggleHideMargin: () => void;
  transportPerKgClient: number;
  carrierIsDirect: boolean;
  coutTransportTotal: number;
  positionCost: PositionCostDetail | null;
  margeBruteTotal: number;
  margeBruteKg: number;
  margeNetteTotal: number;
  margeNetteKg: number;
  margeNettePct: number;
}) {
  // Feu tricolore mappé sur les 4 rôles sémantiques : à perte = destructive,
  // < 10 % = warning (attention), ≥ 10 % = success (validé).
  const TONE = {
    rose: "text-destructive",
    amber: "text-warning",
    emerald: "text-success",
  } as const;
  const DOT = {
    rose: "bg-destructive",
    amber: "bg-warning",
    emerald: "bg-success",
  } as const;
  const RING = {
    rose: "border-destructive/40 bg-destructive/[0.06]",
    amber: "border-warning/40 bg-warning/[0.06]",
    emerald: "border-success/40 bg-success/[0.06]",
  } as const;
  const isPos = marginUnit === "position";
  const fmtE = (v: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v)} €`;
  const fmtK = (v: number) => `${v.toFixed(3)} €/kg`;
  // Vue /kg : « n.c. » si aucune ligne n'a de poids connu (sinon 0,000 €/kg trompeur).
  const kgTxt = (v: number) => (hasKgData ? fmtK(v) : "n.c.");
  // Marge MASQUÉE (épaule) : les montants de marge deviennent « ••• ».
  const m = (txt: string) => (hideMargin ? "•••" : txt);
  const transpTxt = transportPerKgClient > 0 || carrierIsDirect
    ? (isPos ? fmtE(coutTransportTotal) : fmtK(transportPerKgClient))
    : "externe n.c.";
  // Résumé de la ligne repliée : la marge nette dans l'unité choisie + %.
  const netTxt = m(isPos ? fmtE(margeNetteTotal) : kgTxt(margeNetteKg));
  const showPct = (isPos || hasKgData) && !hideMargin;

  return (
    <div className={`mt-1 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${hasCostData ? RING[netTone] : "border-border/60 bg-secondary/20"}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Voir le détail (coût transport, marge brute, /livraison ↔ /kg)"
            className="flex-1 min-w-0 inline-flex items-center gap-2 text-left"
          >
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${DOT[netTone]}`} aria-hidden />
            <span className="text-caption2 uppercase tracking-wide font-semibold text-muted-foreground shrink-0">Marge nette</span>
            {hasCostData ? (
              <span className="inline-flex items-baseline gap-1.5 min-w-0">
                <span className={`tnum font-extrabold text-callout leading-none ${TONE[netTone]}`}>{netTxt}</span>
                {showPct && <span className={`tnum font-bold text-caption ${TONE[netTone]}`}>· {margeNettePct.toFixed(1)} %</span>}
              </span>
            ) : (
              <span className="text-caption2 text-muted-foreground/80 truncate">n.c. · prix d&apos;achat manquant</span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[280px] p-3">
          {/* Bascule /livraison ↔ /kg + prix transport unitaire de référence */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-border/60 overflow-hidden text-caption2 font-semibold">
              <button type="button" onClick={() => setMarginUnit("position")} className={`px-2 h-6 ${isPos ? "bg-brand-500/20 text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:text-foreground"}`}>/livr.</button>
              <button type="button" onClick={() => setMarginUnit("kg")} className={`px-2 h-6 ${!isPos ? "bg-brand-500/20 text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:text-foreground"}`}>/kg</button>
            </div>
            <span className="inline-flex items-center gap-1 text-caption2 text-muted-foreground whitespace-nowrap">
              <Truck className="h-3 w-3" />
              <b className="tnum text-foreground">
                {positionCost
                  ? `${positionCost.total.toFixed(2)} €/pos. (${positionCost.bracket.minKg}–${positionCost.bracket.maxKg ?? "∞"} kg)`
                  : transportPerKgClient > 0 ? `${transportPerKgClient.toFixed(3)} €/kg` : (carrierIsDirect ? "0 €/kg" : "n.c.")}
              </b>
            </span>
          </div>
          {hasCostData ? (
            <div className="mt-2 space-y-1 text-caption text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>Transport</span><b className="tnum text-foreground">{transpTxt}</b>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Marge brute</span><b className="tnum text-foreground">{m(isPos ? fmtE(margeBruteTotal) : kgTxt(margeBruteKg))}</b>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-1 mt-1">
                <span className="font-medium text-foreground">{isPos ? "Marge nette livraison" : "Marge nette /kg"}</span>
                <span className={`tnum font-extrabold text-callout ${TONE[netTone]}`}>{netTxt}</span>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-caption2 text-muted-foreground/80">
              Transport {transpTxt} · marge indisponible (prix d&apos;achat manquant).
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Masquer la marge (regard par-dessus l'épaule) — le feu tricolore reste. */}
      <button
        type="button" onClick={toggleHideMargin}
        aria-label={hideMargin ? "Afficher la marge" : "Masquer la marge"}
        title={hideMargin ? "Afficher la marge" : "Masquer la marge (regard par-dessus l'épaule) — le feu tricolore reste"}
        className="inline-flex items-center justify-center h-6 w-6 shrink-0 rounded border border-border/60 text-muted-foreground hover:text-foreground"
      >
        {hideMargin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
