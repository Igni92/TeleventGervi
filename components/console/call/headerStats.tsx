"use client";

import * as React from "react";
import { BellRing, CheckCircle2 } from "lucide-react";
import { StatLine, type StatLineItem } from "@/components/ui/stat-line";
import { Banner } from "@/components/ui/banner";
import type { ConsoleData, DueRappel } from "./shared";

/**
 * En-tête de la console : la date du jour + une StatLine calme (plus de tuiles
 * à hover-lift trompeur). Le chiffre clé « Restants » ouvre la ligne ; couleur
 * = état uniquement (commandes = validé, à demain = attention).
 */
export function ConsoleHeader({ stats }: { stats: ConsoleData["stats"] }) {
  const date = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });
  const items: StatLineItem[] = [
    { label: "Restants", value: stats.remaining },
    { label: "Appelés", value: stats.called },
    { label: "Commandes", value: stats.commandes, tone: "success" },
    { label: "À demain", value: stats.demains, tone: "warning" },
    { label: "Conv.", value: `${stats.conversion} %` },
  ];
  return (
    <header className="flex items-end justify-between gap-6 flex-wrap">
      <div>
        <p className="kicker mb-1.5">Console télévente</p>
        <h1 className="font-display text-title1 font-semibold text-foreground tracking-tight leading-none">
          {date.charAt(0).toUpperCase() + date.slice(1)}
        </h1>
      </div>
      {/* Stats masquées sur mobile : on veut la file d'appel, pas le score. */}
      <StatLine items={items} className="hidden md:block" />
    </header>
  );
}

/**
 * Bandeau « rappels dus maintenant » — surface les Rappel PLANIFIE dont l'heure
 * est passée. Ton « attention » (ambre) aligné sur la pile de bandeaux. Clic sur
 * le nom = sélectionne le client dans la file ; « Fait » = clôt le rappel.
 */
export function DueRappelsBanner({
  items, onOpen, onDone,
}: {
  items: DueRappel[];
  onOpen: (clientId: string) => void;
  onDone: (rappelId: string) => void;
}) {
  return (
    <div role="status" className="rounded-xl px-4 py-3 ring-1 bg-warning/10 ring-warning/25">
      <div className="flex items-center gap-2 mb-2">
        <BellRing className="h-4 w-4 text-warning shrink-0" />
        <p className="text-body font-semibold text-foreground">
          {items.length} rappel{items.length > 1 ? "s" : ""} dû{items.length > 1 ? "s" : ""} maintenant
        </p>
      </div>
      <ul className="space-y-1">
        {items.slice(0, 6).map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-caption">
            <button
              type="button"
              onClick={() => onOpen(r.clientId)}
              className="font-medium text-foreground hover:text-primary truncate max-w-[45%] text-left"
              title="Sélectionner ce client"
            >
              {r.clientNom}
            </button>
            <span className="text-muted-foreground tnum shrink-0">
              {new Date(r.dateRappel).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
            {r.note && <span className="text-muted-foreground/80 italic truncate flex-1 min-w-0">— {r.note}</span>}
            <button
              type="button"
              onClick={() => onDone(r.id)}
              className="ml-auto shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-caption font-semibold text-success hover:bg-success/10 ring-1 ring-success/40"
            >
              <CheckCircle2 className="h-3 w-3" /> Fait
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bandeau présence / couverture — commerciaux absents et clients à reprendre.
 * Rendu via la primitive Banner (ton « attention ») pour une pile homogène avec
 * les rappels dus.
 */
export function PresenceBanner({ presence }: { presence: NonNullable<ConsoleData["presence"]> }) {
  const nbAbsent = presence.absent.length;
  return (
    <Banner
      tone="warning"
      action={
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- navigation full-reload volontaire (comportement préexistant inchangé)
        <a href="/commerciaux" className="text-caption font-medium text-warning hover:underline">
          Gérer les présences →
        </a>
      }
    >
      <span className="font-semibold text-foreground">{nbAbsent} absent{nbAbsent > 1 ? "s" : ""}</span>
      {" "}({presence.absent.join(", ")})
      {presence.toCover > 0 && (
        <> · <span className="font-semibold text-foreground">{presence.toCover} client{presence.toCover > 1 ? "s" : ""} à couvrir</span> dans ta file</>
      )}
    </Banner>
  );
}
