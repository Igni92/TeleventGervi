"use client";

import * as React from "react";
import { Clock, BellRing, AlertTriangle } from "lucide-react";
import { hourWindowLabel } from "@/lib/insights";
import { segmentBadgeClass } from "@/lib/segments";
import { type Client, JOURS_FR, handledTimeLabel } from "./shared";

/**
 * QueueRow — ligne de file épurée (doctrine « listes groupées »).
 *  L1 : ● Nom .......................... 1 badge d'état (max)
 *  L2 : créneau / heure de commande · jours d'appel (texte passif) ..... TYPE
 *
 * UN seul point d'état couleur + UN seul badge : le reste (tier, incidents,
 * cycle de vie détaillé) est relégué à la fiche centrale. Le téléphone quitte
 * la ligne — le CTA d'appel géant vit dans le panneau d'action. Les jours
 * d'appel deviennent un texte passif « Lun · Mer · Ven », plus des pastilles.
 */

type BadgeTone = "danger" | "warning" | "neutral";
const BADGE_TONE: Record<BadgeTone, string> = {
  danger: "bg-destructive/12 text-destructive ring-1 ring-destructive/25",
  warning: "bg-warning/12 text-warning ring-1 ring-warning/25",
  neutral: "bg-secondary text-muted-foreground ring-1 ring-border",
};

// Cycle de vie → rôle couleur (les 4 rôles seulement ; violet réservé au tarif).
const LC_TONE: Record<string, BadgeTone> = {
  EN_RETARD: "warning",
  A_RISQUE: "warning",
  ENDORMI: "neutral",
  PERDU: "danger",
};

interface PrimaryBadge {
  tone: BadgeTone;
  label: string;
  icon?: React.ElementType;
  title: string;
}

/**
 * Sélectionne LE badge unique de la ligne, par ordre d'urgence décroissant.
 * Tout le reste est visible dans la fiche centrale.
 */
function primaryBadge(client: Client, done: boolean, dueTime: string | null): PrimaryBadge | null {
  if (!done && client.dueReminderAt && dueTime) {
    return { tone: "danger", icon: BellRing, label: `Rappel ${dueTime}`, title: `Rappel dû à ${dueTime}` };
  }
  if (!done && !!client.openIncidents && client.openIncidents > 0) {
    return { tone: "danger", icon: AlertTriangle, label: String(client.openIncidents), title: `${client.openIncidents} incident(s) ouvert(s)` };
  }
  if (client.ownerAbsent) {
    return { tone: "warning", label: "à couvrir", title: `${client.claimedFrom} absent — client repris à couvrir` };
  }
  if (!done && client.retryAfterNrp) {
    return { tone: "warning", icon: Clock, label: "Retenter", title: "Tenté aujourd'hui sans réponse — à retenter plus tard" };
  }
  const lc = client.lifecycle;
  if (lc && LC_TONE[lc.state]) {
    return { tone: LC_TONE[lc.state], label: lc.label, title: client.priority?.reason ?? lc.label };
  }
  if (client.claimedFrom) {
    return { tone: "neutral", label: "récup.", title: `Récupéré de ${client.claimedFrom}` };
  }
  if (client.tier && (client.tier.tier === "A" || client.tier.tier === "B")) {
    const ca = typeof client.ca12m === "number" && client.ca12m > 0
      ? ` · ${Math.round(client.ca12m).toLocaleString("fr-FR")} € sur 12 mois` : "";
    return { tone: "neutral", label: client.tier.tier, title: `Valeur client : ${client.tier.label}${ca}` };
  }
  return null;
}

// Ordre lun→dim pour le texte passif des jours d'appel.
const JOURS_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const QueueRow = React.memo(function QueueRow({
  client,
  active,
  done,
  onSelect,
  onContext,
}: { client: Client; active: boolean; done?: boolean; onSelect: (id: string) => void; onContext?: (e: React.MouseEvent, client: Client) => void }) {
  // Créneau affiché : décroché perso (hourWindowLabel privilégie bestPickup),
  // sinon repli sur l'heure typique du type (cold-start).
  let window = client.insights ? hourWindowLabel(client.insights) : null;
  if ((!window || window === "—") && client.fallbackHour != null) {
    window = `~${client.fallbackHour}h`;
  }
  // « Fait » → heure de prise de commande (remplace le créneau dans la file).
  const handledTime = done ? handledTimeLabel(client) : null;
  // Rappel DÛ (heure passée) → ligne colorée + badge « Rappel HH:MM ».
  const dueReminder = !done && !!client.dueReminderAt;
  const dueTime = client.dueReminderAt
    ? new Date(client.dueReminderAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : null;
  const badge = primaryBadge(client, !!done, dueTime);
  // Jours d'appel — texte passif « Lun · Mer · Ven ».
  const days = client.joursAppel
    ? client.joursAppel.split(",").map(Number).filter((n) => !isNaN(n))
    : [];
  const joursText = JOURS_ORDER.filter((d) => days.includes(d)).map((d) => JOURS_FR[d]).join(" · ");

  return (
    <li>
      <button
        onClick={() => onSelect(client.id)}
        onContextMenu={onContext ? (e) => onContext(e, client) : undefined}
        title={onContext ? "Clic droit : inactiver ou réassigner" : undefined}
        className={`w-full text-left px-4 py-2 border-l-2 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] group
          ${active
            ? "bg-primary/10 border-l-primary"
            : dueReminder
            ? "bg-destructive/[0.06] border-l-destructive hover:bg-destructive/10"
            : "border-l-transparent hover:bg-secondary/50"}
          ${done ? "opacity-60 hover:opacity-90" : ""}
        `}
      >
        {/* ── L1 — dot + nom + badge unique à droite ── */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${
            done
              ? "bg-success"
              : active
              ? "bg-primary dot-accent"
              : dueReminder
              ? "bg-destructive"
              : "bg-border group-hover:bg-foreground/30"
          }`} />
          <p className={`text-body truncate min-w-0 ${
            active ? "font-semibold text-foreground" : "font-medium text-foreground/85"
          }`}>
            {client.nom}
          </p>
          {badge && (
            <span
              className={`ml-auto shrink-0 inline-flex items-center gap-0.5 text-caption2 font-semibold px-1.5 py-px rounded ${BADGE_TONE[badge.tone]}`}
              title={badge.title}
            >
              {badge.icon && <badge.icon className="h-2.5 w-2.5" />}
              {badge.label}
            </span>
          )}
        </div>

        {/* ── L2 — heure de commande (fait) OU créneau + jours passifs / TYPE ── */}
        <div className="flex items-center gap-2 mt-0.5 pl-4 min-w-0">
          {handledTime ? (
            <span
              className="inline-flex items-center gap-1 text-caption2 font-mono tnum text-success shrink-0"
              title="Heure de prise de commande"
            >
              <Clock className="h-2.5 w-2.5" /> {handledTime}
            </span>
          ) : !done && window && window !== "—" ? (
            <span className="text-caption2 font-mono tnum text-muted-foreground shrink-0">
              {window}
            </span>
          ) : null}
          {!done && joursText && (
            <span className="text-caption2 text-muted-foreground/70 truncate min-w-0" title="Jours d'appel programmés">
              {joursText}
            </span>
          )}
          {client.type && (
            <span className={`ml-auto shrink-0 text-caption2 font-semibold tracking-wider px-1.5 py-px rounded leading-tight ${segmentBadgeClass(client.type)}`}>
              {client.type}
            </span>
          )}
        </div>
      </button>
    </li>
  );
});
QueueRow.displayName = "QueueRow";
