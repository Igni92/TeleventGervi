"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Champ de date/heure d'un rappel — ÉDITEUR SEGMENTÉ (comme le champ natif).
 *
 * Le jour de la semaine « JEU » est calculé automatiquement et NON modifiable.
 * Seuls les segments `JJ.MM.AA` et `HH:MM` se saisissent au clavier, chacun
 * indépendamment : changer le jour ne touche ni le mois ni l'année.
 * Par défaut : date du jour (jour/mois/année en cours) et heure à 05:00.
 *
 * Contrôlé : `value` est une chaîne « YYYY-MM-DDTHH:mm » (`""` = vide).
 */

const WD = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"] as const;
const pad = (n: number) => n.toString().padStart(2, "0");
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const daysInMonth = (y: number, mo: number) => new Date(y, mo, 0).getDate();

type SegKey = "d" | "mo" | "yy" | "h" | "mi";
type Parts = Record<SegKey, string>;

/** Heure par défaut selon le jour : rappel du jour → heure actuelle + 1 ; autre jour → 5h. */
function defaultHour(y: number, mo: number, d: number, now: Date): { h: string; mi: string } {
  const isToday = y === now.getFullYear() && mo === now.getMonth() + 1 && d === now.getDate();
  if (isToday) return { h: pad(Math.min(now.getHours() + 1, 23)), mi: "00" };
  return { h: "05", mi: "00" };
}

function partsFromValue(value: string, now: Date): Parts {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (m) return { yy: m[1].slice(2), mo: m[2], d: m[3], h: m[4], mi: m[5] };
  // Défaut : aujourd'hui, heure = maintenant + 1.
  const { h, mi } = defaultHour(now.getFullYear(), now.getMonth() + 1, now.getDate(), now);
  return { d: pad(now.getDate()), mo: pad(now.getMonth() + 1), yy: pad(now.getFullYear() % 100), h, mi };
}

function buildValue(p: Parts): string {
  const yy = p.yy === "" ? 0 : clamp(parseInt(p.yy, 10) || 0, 0, 99);
  const y = 2000 + yy;
  const mo = clamp(parseInt(p.mo, 10) || 1, 1, 12);
  const d = clamp(parseInt(p.d, 10) || 1, 1, daysInMonth(y, mo));
  const h = clamp(parseInt(p.h, 10) || 0, 0, 23);
  const mi = clamp(parseInt(p.mi, 10) || 0, 0, 59);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

function weekdayOf(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!m) return "—";
  return WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
}

export function RappelDateField({
  id,
  value,
  onChange,
  min,
  invalid,
  autoFocus,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [parts, setParts] = useState<Parts>(() => partsFromValue(value, new Date()));
  // Tant que l'utilisateur n'a pas fixé l'heure lui-même, elle suit le jour choisi.
  const [hourTouched, setHourTouched] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const refs: Record<SegKey, RefObject<HTMLInputElement | null>> = {
    d: useRef(null), mo: useRef(null), yy: useRef(null), h: useRef(null), mi: useRef(null),
  };

  // Défaut = aujourd'hui à 5h quand vide ; resync si la valeur change hors composant (sélecteur).
  useEffect(() => {
    if (!value) {
      const today = partsFromValue("", new Date());
      setParts(today);
      onChange(buildValue(today));
    } else if (value !== buildValue(parts)) {
      setParts(partsFromValue(value, new Date()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (next: Parts) => {
    setParts(next);
    onChange(buildValue(next));
  };

  const order: SegKey[] = ["d", "mo", "yy", "h", "mi"];
  const hi = (k: SegKey): number => {
    if (k === "d") return daysInMonth(2000 + (parseInt(parts.yy, 10) || 0), parseInt(parts.mo, 10) || 1);
    if (k === "mo") return 12;
    if (k === "yy") return 99;
    if (k === "h") return 23;
    return 59;
  };
  const lo = (k: SegKey): number => (k === "d" || k === "mo" ? 1 : 0);

  // Recale l'heure sur le défaut du jour choisi, sauf si l'utilisateur l'a fixée.
  const autoHour = (p: Parts): Parts => {
    if (hourTouched) return p;
    const now = new Date();
    const y = 2000 + (parseInt(p.yy, 10) || 0);
    const mo = clamp(parseInt(p.mo, 10) || 1, 1, 12);
    const d = clamp(parseInt(p.d, 10) || 1, 1, daysInMonth(y, mo));
    return { ...p, ...defaultHour(y, mo, d, now) };
  };

  const onSeg = (k: SegKey, raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    let next: Parts = { ...parts, [k]: digits };
    if (k === "h" || k === "mi") setHourTouched(true);
    else next = autoHour(next);
    emit(next);
    if (digits.length === 2) {
      const nx = order[order.indexOf(k) + 1];
      if (nx) refs[nx].current?.focus();
    }
  };

  const step = (k: SegKey, delta: number) => {
    const cur = parseInt(parts[k], 10);
    const base = Number.isFinite(cur) ? cur : lo(k);
    let v = base + delta;
    if (v > hi(k)) v = lo(k);
    if (v < lo(k)) v = hi(k);
    let next: Parts = { ...parts, [k]: pad(v) };
    if (k === "h" || k === "mi") setHourTouched(true);
    else next = autoHour(next);
    emit(next);
  };

  const normalize = () => setParts(partsFromValue(buildValue(parts), new Date()));

  const openPicker = () => {
    const el = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    try { el?.showPicker?.(); } catch { el?.focus(); }
  };

  const seg = (k: SegKey, ariaLabel: string, first = false) => (
    <input
      ref={refs[k]}
      id={first ? id : undefined}
      type="text"
      inputMode="numeric"
      autoFocus={first && autoFocus}
      aria-label={ariaLabel}
      value={parts[k]}
      onChange={(e) => onSeg(k, e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={normalize}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); step(k, 1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); step(k, -1); }
        else if (e.key === "Enter") { e.preventDefault(); normalize(); }
      }}
      className="w-[2.6ch] bg-transparent text-center tabular-nums outline-none"
    />
  );

  return (
    <div className="relative">
      <div
        className={cn(
          "flex h-10 w-full items-center rounded-md border border-input bg-background pl-3 pr-10 text-sm font-semibold text-brand-600 dark:text-brand-400",
          invalid && "border-red-500"
        )}
      >
        <span className="mr-2 select-none text-muted-foreground">{weekdayOf(buildValue(parts))}</span>
        {seg("d", "Jour", true)}
        <span className="select-none opacity-60">.</span>
        {seg("mo", "Mois")}
        <span className="select-none opacity-60">.</span>
        {seg("yy", "Année")}
        <span className="mx-2 select-none opacity-40">·</span>
        {seg("h", "Heure")}
        <span className="select-none opacity-60">:</span>
        {seg("mi", "Minute")}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Ouvrir le calendrier"
        onClick={openPicker}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
      >
        <CalendarClock className="h-4 w-4" />
      </button>
      {/* Sélecteur natif (souris) — invisible, piloté par le bouton. */}
      <input
        ref={pickerRef}
        type="datetime-local"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-2 h-0 w-0 opacity-0"
      />
    </div>
  );
}
