"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CATEGORICAL } from "./theme";
import { DUR, EASE } from "@/lib/motion";

export interface BarItem {
  label: string;
  value: number;
  /** sous-libellé optionnel (ex. nb commandes) */
  hint?: string;
  /** couleur custom, sinon palette catégorielle */
  color?: string;
  /** identifiant optionnel — passé à onSelect au clic */
  id?: string;
}

interface BarListProps {
  items: BarItem[];
  format?: (v: number) => string;
  /** nombre max d'items affichés */
  max?: number;
  className?: string;
  /** rend chaque ligne cliquable (drill-down) — reçoit item.id (ou le label). */
  onSelect?: (id: string) => void;
}

/**
 * Liste de barres classée (style "Top clients / fournisseurs").
 *
 * - Barre = part de la valeur max ; largeur animée (transform-friendly via scaleX).
 * - Densité élevée, labels directs (cf. direct-labeling) — pas besoin d'axe.
 * - Cascade d'entrée (stagger) qui respecte reduced-motion.
 * - Accessible : chaque ligne est lisible texte seul (label + valeur).
 */
export function BarList({
  items,
  format = (v) => new Intl.NumberFormat("fr-FR").format(Math.round(v)),
  max = 6,
  className,
  onSelect,
}: BarListProps) {
  const reduce = useReducedMotion();
  const rows = items.slice(0, max);
  const peak = Math.max(1, ...rows.map((r) => r.value));

  if (rows.length === 0) {
    return (
      <p className="text-[12px] italic text-muted-foreground py-3 text-center">
        Aucune donnée sur la période.
      </p>
    );
  }

  return (
    <ul className={className}>
      {rows.map((r, i) => {
        const pct = Math.max(2, (r.value / peak) * 100);
        const color = r.color ?? CATEGORICAL[i % CATEGORICAL.length];
        const clickable = !!onSelect;
        return (
          <li
            key={r.label}
            className={`group relative py-1 ${clickable ? "cursor-pointer rounded-md -mx-1 px-1 hover:bg-secondary/50 transition-colors" : ""}`}
            onClick={clickable ? () => onSelect!(r.id ?? r.label) : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect!(r.id ?? r.label); } } : undefined}
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-[12px] font-medium text-foreground truncate flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-[3px] shrink-0" style={{ background: color }} />
                <span className="truncate">{r.label}</span>
                {r.hint && <span className="text-[10.5px] text-muted-foreground shrink-0">· {r.hint}</span>}
              </span>
              <span className="text-[12px] font-semibold tnum text-foreground shrink-0">{format(r.value)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
              {/* width (pas scaleX) pour ne pas déformer le rayon des extrémités */}
              <motion.div
                className="h-full rounded-full"
                style={{ background: color }}
                initial={{ width: reduce ? `${pct}%` : "0%" }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: DUR.slow, ease: EASE.out, delay: reduce ? 0 : i * 0.04 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
