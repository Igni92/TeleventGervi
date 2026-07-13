"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Clock } from "lucide-react";
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
 * points (« LUN 13.07.26 ») — au-dessus d'un <input type="date"> natif (invisible
 * mais cliquable) qui ouvre le calendrier et reste éditable au clavier.
 *
 * Heure optionnelle : passer `time` + `onTimeChange` ajoute une ligne « heure »
 * sous la date (ex. heure de réception de la marchandise / de prise de commande).
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
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <div className="flex items-center gap-1.5">
        <button
          type="button" onClick={() => shift(-1)} aria-label="Jour précédent"
          className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Case date : format SAP « LUN 13.07.26 » par-dessus l'input natif. */}
        <div className="relative flex-1 min-w-0">
          <input
            ref={dateRef}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={openPicker}
            aria-label="Choisir la date"
            className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          />
          <div className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-[13px] font-semibold uppercase tracking-wide tnum text-foreground peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{value ? fmtJourDate(value) : "—"}</span>
          </div>
        </div>

        <button
          type="button" onClick={() => shift(1)} aria-label="Jour suivant"
          className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Ligne heure (optionnelle), alignée sous la case entre les deux flèches. */}
      {onTimeChange && (
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-10 w-10 shrink-0" />
          <div className="relative flex-1 min-w-0">
            <Clock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-10 h-4 w-4 text-muted-foreground" />
            <input
              type="time"
              value={time ?? ""}
              onChange={(e) => onTimeChange(e.target.value)}
              onClick={(e) => {
                const el = e.currentTarget;
                if (typeof el.showPicker === "function") { try { el.showPicker(); } catch { /* déjà ouvert : sans effet */ } }
              }}
              aria-label={timeLabel ?? "Heure"}
              className="h-10 w-full cursor-pointer rounded-md border border-input bg-background px-9 text-[13px] font-semibold tnum text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-calendar-picker-indicator]:hidden"
            />
          </div>
          <span aria-hidden className="h-10 w-10 shrink-0" />
        </div>
      )}
    </div>
  );
}
