"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { eventsInWindow, relativeDayLabelLong, type UpcomingEvent } from "@/lib/events";

/**
 * Bannière ÉVÉNEMENTS — remplace l'ancien ruban promos (coin). Affiche en haut
 * à gauche du contenu les temps forts commerciaux de la semaine : fenêtre ±7 j
 * autour d'aujourd'hui (cf. lib/events). Calcul 100 % client (date locale =
 * heure de Paris du poste) → aucun appel réseau. Aucun événement dans la
 * fenêtre → rien (pas d'espace vide). L'occurrence du jour est mise en avant.
 */
export function EventsBanner() {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);

  // Calcul au montage (client) → évite tout mismatch d'hydratation lié à la date.
  useEffect(() => { setEvents(eventsInWindow(new Date())); }, []);

  if (!events || events.length === 0) return null;

  return (
    // Mobile : une SEULE ligne compacte qui défile (plus de gros bloc qui prend
    // 2-3 lignes) ; desktop : chips confortables qui reviennent à la ligne.
    <div
      className="mb-3 sm:mb-5 flex items-center gap-1.5 sm:gap-2 overflow-x-auto sm:flex-wrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden"
      aria-label="Événements de la semaine"
    >
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <CalendarDays className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        Événements
      </span>
      {events.map((ev) => {
        const today = ev.daysFromRef === 0;
        const past = ev.daysFromRef < 0;
        // « Dimanche 22.06.26 » (jour + date), comme demandé.
        const raw = ev.date.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "2-digit", year: "2-digit" });
        const jourDate = (raw.charAt(0).toUpperCase() + raw.slice(1)).replace(/\//g, ".");
        return (
          <span
            key={`${ev.key}-${ev.date.getFullYear()}`}
            title={`${ev.label} — ${jourDate} — ${relativeDayLabelLong(ev.daysFromRef)}`}
            className={[
              "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 sm:px-2.5 h-6 sm:h-7 text-[11px] sm:text-[12px] transition-colors",
              today
                ? "border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300 font-semibold"
                : past
                  ? "border-border bg-secondary/40 text-muted-foreground"
                  : "border-border bg-card text-foreground",
            ].join(" ")}
          >
            <span aria-hidden>{ev.emoji}</span>
            {/* La date complète (longue) n'apparaît que sur desktop — c'est elle
                qui « grossissait » la bannière sur téléphone. */}
            <span className="font-medium whitespace-nowrap">{ev.label}<span className="hidden sm:inline"> — {jourDate}</span></span>
            <span className={`whitespace-nowrap ${today ? "" : "text-muted-foreground"}`}>· {relativeDayLabelLong(ev.daysFromRef)}</span>
          </span>
        );
      })}
    </div>
  );
}
