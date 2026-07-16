"use client";

/**
 * Briques visuelles du dashboard /dashboard — bento puzzle, sans scroll.
 *
 * - `Tile` : tuile rectangulaire avec span configurable (col/row).
 * - `BigKpi` : gros chiffre + label + delta YoY + sparkline en fond.
 * - `MiniKpi` : tuile compacte (panier moyen, # clients…).
 * - `TopList` : liste rang + nom + valeur.
 * - `Heatmap7x12` : heatmap jour × heure.
 *
 * La grille parent utilise `grid-template-columns: repeat(12, 1fr)` et
 * `grid-template-rows: repeat(8, 1fr)` sur un viewport `h-screen overflow-hidden`.
 */

import { ReactNode, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Delta } from "@/components/ui/delta";
import { Sparkline as VisxSparkline } from "@/components/charts/Sparkline";

/* ─────────────────────────────────────────────────────────────────
   Format helpers
   ───────────────────────────────────────────────────────────────── */
export function formatEuro(v: number, compact = false): string {
  if (compact && Math.abs(v) >= 1000) {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} M€`;
    return `${(v / 1000).toFixed(1)} k€`;
  }
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}
export function formatNum(v: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
}
export function formatPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

/* ─────────────────────────────────────────────────────────────────
   Tile — conteneur générique avec grid placement.
   ───────────────────────────────────────────────────────────────── */
export function Tile({
  children, colSpan = 3, rowSpan = 2, title, accent, className = "",
}: {
  children: ReactNode;
  colSpan?: number;
  rowSpan?: number;
  title?: string;
  accent?: "brand" | "emerald" | "rose" | "violet" | "amber" | "sky";
  className?: string;
}) {
  const accentBorder =
    accent === "emerald" ? "border-l-emerald-500" :
    accent === "rose"    ? "border-l-rose-500" :
    accent === "violet"  ? "border-l-violet-500" :
    accent === "amber"   ? "border-l-amber-500" :
    accent === "sky"     ? "border-l-sky-500" :
    accent === "brand"   ? "border-l-brand-500" : "";
  // Spotlight curseur retiré (redesign 07/2026) : effet « template IA »,
  // coût mousemove permanent pour zéro information.
  return (
    <section
      className={`relative bg-card border border-border rounded-xl overflow-hidden flex flex-col p-4 ${accent ? `border-l-4 ${accentBorder}` : ""} ${className}`}
      style={{
        gridColumn: `span ${colSpan} / span ${colSpan}`,
        gridRow: `span ${rowSpan} / span ${rowSpan}`,
      }}
    >
      {title && (
        <h3 className="relative text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2 shrink-0">
          {title}
        </h3>
      )}
      <div className="relative flex-1 min-h-0">{children}</div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   RefreshButton — actualise les données de l'écran (busting du cache
   serveur via refresh=1). Présent dans l'en-tête de chaque écran stats.
   ───────────────────────────────────────────────────────────────── */
export function RefreshButton({ onClick, title = "Actualiser les données" }: { onClick: () => void; title?: string }) {
  const [spin, setSpin] = useState(false);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => { setSpin(true); onClick(); window.setTimeout(() => setSpin(false), 900); }}
      className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${spin ? "animate-spin" : ""}`} />
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Delta YoY pill — réutilisé par tous les KPI.
   ───────────────────────────────────────────────────────────────── */
/**
 * Pastille YoY du dashboard — délègue au composant unique `Delta`
 * (source de vérité : même seuil dead-band, même garde base négative, icône+signe
 * accessible). Conservé comme nom pour ne pas toucher tous les call-sites.
 */
export function YoYPill({ curr, prev }: { curr: number; prev: number }) {
  return <Delta curr={curr} prev={prev} size="sm" />;
}

/* ─────────────────────────────────────────────────────────────────
   Big KPI — pour CA principal. Spark en fond.
   ───────────────────────────────────────────────────────────────── */
export function BigKpi({
  label, value, curr, prev, spark, hint, format, animateOnMount,
}: {
  label: string;
  value: string;
  curr: number;
  prev: number;
  spark?: number[];
  hint?: string;
  /** si fourni → la valeur compte à rebours (count-up) avec ce formateur */
  format?: (n: number) => string;
  animateOnMount?: boolean;
}) {
  return (
    <div className="relative h-full flex flex-col">
      <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
        {label}
      </p>
      <p className="text-[clamp(28px,4.5vw,56px)] font-semibold text-foreground tracking-tight leading-none tnum mt-1.5">
        {format ? <AnimatedNumber value={curr} format={format} animateOnMount={animateOnMount} /> : value}
      </p>
      <div className="flex items-center gap-3 mt-2">
        <YoYPill curr={curr} prev={prev} />
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {spark && spark.length > 0 && (
        <div className="mt-auto pt-3">
          <Sparkline data={spark} height={48} className="text-brand-500" />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Mini KPI — pour panier, # clients, # commandes.
   ───────────────────────────────────────────────────────────────── */
export function MiniKpi({
  label, value, curr, prev, format, animateOnMount,
}: { label: string; value: string; curr: number; prev: number; format?: (n: number) => string; animateOnMount?: boolean }) {
  return (
    <div className="flex flex-col justify-between h-full">
      <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
        {label}
      </p>
      <div>
        <p className="text-[clamp(20px,2.6vw,32px)] font-semibold text-foreground tracking-tight leading-none tnum">
          {format ? <AnimatedNumber value={curr} format={format} animateOnMount={animateOnMount} /> : value}
        </p>
        <div className="mt-1.5"><YoYPill curr={curr} prev={prev} /></div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Sparkline — full width path, sans axe.
   ───────────────────────────────────────────────────────────────── */
/**
 * Sparkline du dashboard — délègue à l'implémentation visx unique (accessible,
 * baseline min/max réelle, theming par tone). Évite la 2ᵉ implémentation maison.
 */
export function Sparkline({
  data, height = 32, className = "",
}: { data: number[]; height?: number; className?: string }) {
  if (!data.length) return null;
  return (
    <VisxSparkline
      data={data}
      height={height}
      tone="brand"
      responsive
      className={className}
      aria-label="Tendance de la période"
    />
  );
}

/* ─────────────────────────────────────────────────────────────────
   TopList — rang + nom + valeur + YoY optionnel. Scrollable interne.
   ───────────────────────────────────────────────────────────────── */
export function TopList<T extends { name: string; value: number; prev?: number; sub?: string }>({
  items, fmt = (v) => formatEuro(v, true),
}: { items: T[]; fmt?: (v: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ol className="h-full flex flex-col gap-1 overflow-hidden">
      {items.map((it, i) => {
        const bar = (it.value / max) * 100;
        return (
          <li key={i} className="grid grid-cols-[20px_1fr_auto_50px] items-center gap-2 text-[12px]">
            <span className="text-muted-foreground/70 tnum text-right">{i + 1}</span>
            <div className="min-w-0 relative">
              <div className="absolute inset-y-0 left-0 bg-brand-500/15 rounded-sm" style={{ width: `${bar}%` }} />
              <div className="relative px-1.5 py-1 truncate">
                <span className="font-medium text-foreground truncate block">{it.name}</span>
                {it.sub && <span className="text-[10px] text-muted-foreground">{it.sub}</span>}
              </div>
            </div>
            <span className="font-semibold tnum text-foreground tabular-nums whitespace-nowrap">
              {fmt(it.value)}
            </span>
            <span className="text-right">
              {it.prev != null && <YoYPill curr={it.value} prev={it.prev} />}
            </span>
          </li>
        );
      })}
      {items.length === 0 && (
        <li className="text-[12px] text-muted-foreground py-2">Aucune donnée sur la période.</li>
      )}
    </ol>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MixedTopList — top liste avec 2 valeurs par ligne (CA SAP + #appels CRM).
   La barre se base sur `value`. La colonne `secondary` se lit en clair à droite.
   Voix Council #2 : l'écart entre les deux raconte sous/sur-monétisation.
   ───────────────────────────────────────────────────────────────── */
export function MixedTopList<T extends {
  name: string;
  value: number;        // ex: CA SAP
  secondary: number;    // ex: # appels CRM
  prev?: number;
}>({
  items,
  fmtPrimary = (v) => formatEuro(v, true),
  fmtSecondary = (v) => `${formatNum(v)} app.`,
  primaryLabel = "CA",
  secondaryLabel = "Appels",
}: {
  items: T[];
  fmtPrimary?: (v: number) => string;
  fmtSecondary?: (v: number) => string;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="h-full flex flex-col gap-1 overflow-hidden">
      <div className="grid grid-cols-[20px_1fr_60px_50px_44px] items-center gap-2 text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/80 shrink-0">
        <span />
        <span>Client</span>
        <span className="text-right">{primaryLabel}</span>
        <span className="text-right">{secondaryLabel}</span>
        <span className="text-right">N-1</span>
      </div>
      <ol className="flex-1 flex flex-col gap-1 overflow-hidden">
        {items.map((it, i) => {
          const bar = (it.value / max) * 100;
          // Détection sous-monétisé : peu d'appels & CA fort = client "facile"
          // Sur-monétisé / fragile : beaucoup d'appels & CA faible
          return (
            <li key={i} className="grid grid-cols-[20px_1fr_60px_50px_44px] items-center gap-2 text-[12px]">
              <span className="text-muted-foreground/70 tnum text-right">{i + 1}</span>
              <div className="min-w-0 relative">
                <div className="absolute inset-y-0 left-0 bg-brand-500/15 rounded-sm" style={{ width: `${bar}%` }} />
                <div className="relative px-1.5 py-1 truncate">
                  <span className="font-medium text-foreground truncate block">{it.name}</span>
                </div>
              </div>
              <span className="text-right font-semibold tnum text-foreground tabular-nums whitespace-nowrap">
                {fmtPrimary(it.value)}
              </span>
              <span className={`text-right tnum tabular-nums whitespace-nowrap text-[11px] ${
                it.secondary === 0 ? "text-rose-500/80" : "text-foreground/70"
              }`}>
                {fmtSecondary(it.secondary)}
              </span>
              <span className="text-right">
                {it.prev != null && <YoYPill curr={it.value} prev={it.prev} />}
              </span>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="text-[12px] text-muted-foreground py-2">Aucune donnée sur la période.</li>
        )}
      </ol>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Heatmap 7 jours × 12 heures — repris de DayHourHeatmap mais compact.
   ───────────────────────────────────────────────────────────────── */
export function Heatmap7x12({ matrix }: { matrix: number[][] }) {
  const days = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  const hours = Array.from({ length: 12 }, (_, i) => i + 8);
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="h-full flex flex-col gap-0.5">
      <div className="grid gap-0.5 text-[9px] text-muted-foreground tnum"
        style={{ gridTemplateColumns: "28px repeat(12, 1fr)" }}
      >
        <div />
        {hours.map((h) => <div key={h} className="text-center">{h}</div>)}
      </div>
      {matrix.map((row, di) => (
        <div key={di} className="grid gap-0.5 flex-1"
          style={{ gridTemplateColumns: "28px repeat(12, 1fr)" }}
        >
          <div className="text-[10px] text-foreground/70 font-medium self-center">{days[di]}</div>
          {row.map((v, hi) => {
            const intensity = v / max;
            return (
              <div
                key={hi}
                className="rounded-sm flex items-center justify-center text-[9px]"
                style={{
                  backgroundColor: v === 0 ? "hsl(var(--border) / 0.4)"
                    : `rgba(250, 204, 21, ${0.18 + intensity * 0.72})`,
                  color: intensity > 0.5 ? "rgb(20, 20, 20)" : "hsl(var(--muted-foreground))",
                }}
                title={`${days[di]} ${hi+8}h — ${v}`}
              >
                {v > 0 ? v : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

