"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { fmtJourDate } from "@/lib/date-fr";

/** Date du jour au format yyyy-mm-dd (pour <input type="date">). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Heure courante au format `HH:MM` (pour <input type="time">). */
export function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Sélecteur de date avec flèches ◀ ▶ pour reculer / avancer d'un jour.
 *
 * La case affiche directement le format unifié des états SAP — jour + date en
 * points (« LUN 13.07.26 ») — par-dessus un <input type="date"> natif (invisible
 * mais cliquable) qui ouvre le calendrier et reste éditable au clavier.
 *
 * Heure optionnelle : passer `time` + `onTimeChange` ajoute l'heure À CÔTÉ de la
 * date DANS la même case (« LUN 13.07.26 14:30 ») — ex. heure de réception de
 * la marchandise / de prise de commande. Cliquer le segment date ouvre le
 * calendrier, cliquer le segment heure ouvre l'horloge.
 */
export function DateStepper({
  value, onChange, className, time, onTimeChange, timeLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  /** Heure `HH:MM` — n'affiche la ligne heure que si `onTimeChange` est fourni. */
  time?: string;
  onTimeChange?: (v: string) => void;
  /** Libellé accessible de la ligne heure (défaut : « Heure »). */
  timeLabel?: string;
}) {
  const dateRef = useRef<HTMLInputElement>(null);

  const shift = (days: number) => {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return;
    d.setDate(d.getDate() + days);
    onChange(d.toISOString().slice(0, 10));
  };

  // Ouvre le calendrier natif au clic n'importe où sur la case (showPicker
  // requiert un geste utilisateur — ici l'onClick le fournit).
  const openPicker = () => {
    const el = dateRef.current;
    if (el && typeof el.showPicker === "function") {
      try { el.showPicker(); } catch { /* déjà ouvert / hors geste : sans effet */ }
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <button
        type="button" onClick={() => shift(-1)} aria-label="Jour précédent"
        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* Case unique « LUN 13.07.26 14.30 » : date + heure côte à côte, chaque
          segment posé par-dessus son input natif (calendrier / horloge). */}
      <div
        onClick={openPicker}
        className="flex h-10 flex-1 min-w-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-md border border-input bg-background px-3 text-[13px] font-semibold uppercase tracking-wide tnum text-foreground focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* Segment DATE — « LUN 13.07.26 » */}
        <span className="relative inline-flex items-center whitespace-nowrap">
          <span>{value ? fmtJourDate(value) : "—"}</span>
          <input
            ref={dateRef}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Choisir la date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        {/* Segment HEURE (optionnel) — « 14:30 » (deux-points, format horaire standard) */}
        {onTimeChange && (
          <span className="relative inline-flex items-center whitespace-nowrap">
            <span>{time || "—"}</span>
            <input
              type="time"
              value={time ?? ""}
              onChange={(e) => onTimeChange(e.target.value)}
              onClick={(e) => {
                e.stopPropagation();
                const el = e.currentTarget;
                if (typeof el.showPicker === "function") { try { el.showPicker(); } catch { /* déjà ouvert : sans effet */ } }
              }}
              aria-label={timeLabel ?? "Heure"}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:hidden"
            />
          </span>
        )}
      </div>

      <button
        type="button" onClick={() => shift(1)} aria-label="Jour suivant"
        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
