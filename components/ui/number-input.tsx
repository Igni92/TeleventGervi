"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Saisie numérique robuste — remplace les `<input type="number">` qui ne
 * normalisent pas (« 05 » au lieu de « 0.50 », virgule FR qui casse, `.5`
 * non géré). Pensé pour la saisie répétitive (panier, recettes, réceptions).
 *
 * Comportement :
 *   • type="text" + inputMode="decimal" → contrôle total du format (clavier
 *     numérique sur mobile, pas de quirk navigateur « 05 »).
 *   • Accepte la **virgule** (0,5) et le point décimal seul (.5 → 0.5).
 *   • Pendant la frappe : valeur libre, `onValueChange` envoie le nombre live
 *     (les totaux se mettent à jour). Au **blur** : normalisation + format à
 *     `decimals` décimales (ex. 0.5 → « 0.50 ») + clamp min/max.
 *   • **Select-all au focus** (un clic = remplacer) et flèches ↑/↓ (par `step`).
 */
export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "step"> {
  value: number | null;
  onValueChange: (n: number | null) => void;
  /** Décimales affichées au repos (blur). undefined = pas de zéros forcés (trim). */
  decimals?: number;
  min?: number;
  max?: number;
  /**
   * Plafond SOUPLE (anti-saisie aberrante) : ne CLAMPE pas — laisse passer la
   * valeur mais notifie le parent via `onSoftMaxExceeded` à la validation
   * (blur / Enter / flèche) pour qu'il demande une confirmation. Indépendant de
   * `max` (qui reste un clamp dur). Ignoré si absent.
   */
  softMax?: number;
  /** Appelé quand une valeur validée dépasse `softMax` (cf. softMax). */
  onSoftMaxExceeded?: (n: number) => void;
  /** Incrément des flèches ↑/↓. Défaut 1. */
  step?: number;
  /** Champ vide autorisé → renvoie null (sinon 0). */
  allowEmpty?: boolean;
}

function parseLoose(s: string): number | null {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "" || t === "." || t === "-" || t === "-.") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min?: number, max?: number): number {
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

function display(n: number | null, decimals?: number): string {
  if (n == null) return "";
  return decimals != null ? n.toFixed(decimals) : String(n);
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, decimals, min, max, softMax, onSoftMaxExceeded, step = 1, allowEmpty = false, className, onFocus, onBlur, onKeyDown, ...rest },
  ref,
) {
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  // Au repos : affichage formaté depuis la prop. En édition : le brouillon libre.
  const shown = focused ? draft : display(value, decimals);

  // Anti-saisie aberrante : prévient le parent (sans clamper) si la valeur
  // validée franchit le plafond souple. Le parent décide (confirmation).
  const checkSoftMax = (v: number) => {
    if (softMax != null && v > softMax) onSoftMaxExceeded?.(v);
  };

  const commit = (raw: string) => {
    const parsed = parseLoose(raw);
    if (parsed == null) {
      onValueChange(allowEmpty ? null : 0);
      return allowEmpty ? null : 0;
    }
    const v = clamp(parsed, min, max);
    onValueChange(v);
    checkSoftMax(v);
    return v;
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onFocus={(e) => {
        setFocused(true);
        setDraft(value == null ? "" : String(value));
        // Un clic = remplacer : sélectionne tout le contenu.
        requestAnimationFrame(() => e.target.select());
        onFocus?.(e);
      }}
      onChange={(e) => {
        // Ne garde que chiffres, séparateur décimal et signe — frappe propre.
        const cleaned = e.target.value.replace(/[^\d.,-]/g, "");
        setDraft(cleaned);
        const parsed = parseLoose(cleaned);
        if (parsed != null) onValueChange(clamp(parsed, min, max));
        else if (cleaned === "" && allowEmpty) onValueChange(null);
      }}
      onBlur={(e) => {
        setFocused(false);
        commit(draft);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = parseLoose(focused ? draft : String(value ?? 0)) ?? 0;
          const next = clamp(base + (e.key === "ArrowUp" ? step : -step), min, max);
          const rounded = decimals != null ? Number(next.toFixed(decimals)) : next;
          setDraft(String(rounded));
          onValueChange(rounded);
          checkSoftMax(rounded);
        } else if (e.key === "Enter") {
          commit(draft);
        }
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
});
