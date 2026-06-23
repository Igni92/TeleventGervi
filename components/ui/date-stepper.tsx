"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Date du jour au format yyyy-mm-dd (pour <input type="date">). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sélecteur de date avec flèches ◀ ▶ pour reculer / avancer d'un jour.
 * Par défaut on initialise sur la date du jour côté appelant (todayISO()).
 */
export function DateStepper({
  value, onChange, className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const shift = (days: number) => {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return;
    d.setDate(d.getDate() + days);
    onChange(d.toISOString().slice(0, 10));
  };
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <button
        type="button" onClick={() => shift(-1)} aria-label="Jour précédent"
        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="text-center flex-1 min-w-0" />
      <button
        type="button" onClick={() => shift(1)} aria-label="Jour suivant"
        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
