"use client";

import { useEffect, useState } from "react";
import { RECEPTION_INCIDENTS_CHANGED } from "@/components/entrees/ReceptionIncidents";
import type { NavBadgeKey } from "@/lib/navigation";

/**
 * Pastilles de navigation — UN SEUL poll pour toute la sidebar.
 *
 * Consomme GET /api/nav-badges (agrégat serveur des 5 compteurs, cache TTL) :
 *   • polling ~60 s, aligné sur le TTL serveur ;
 *   • rafraîchissement INSTANTANÉ sur RECEPTION_INCIDENTS_CHANGED : une réserve
 *     déclarée/résolue ailleurs dans l'app met la pastille à jour sans attendre
 *     le tick. Dans ce cas on passe `?refresh=1` pour invalider le cache
 *     serveur (sinon on relirait la même valeur pendant jusqu'à 60 s).
 *
 * Défensif : toute erreur réseau est ignorée, les derniers comptes connus
 * restent affichés (le serveur, lui, renvoie déjà 0 par compteur en échec).
 */

/** Ré-export de commodité — la source de vérité est lib/navigation.ts. */
export type { NavBadgeKey };

const ZERO: Record<NavBadgeKey, number> = {
  notifications: 0,
  offresDue: 0,
  poDue: 0,
  inventaire: 0,
  incidents: 0,
};

/** Coerce défensive : le serveur garantit des nombres, on borne quand même. */
function toCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function useNavBadges(): Record<NavBadgeKey, number> {
  const [badges, setBadges] = useState<Record<NavBadgeKey, number>>(ZERO);

  useEffect(() => {
    let cancelled = false;

    const load = (refresh = false) => {
      fetch(refresh ? "/api/nav-badges?refresh=1" : "/api/nav-badges", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Record<string, unknown> | null) => {
          if (cancelled || !j || j.ok !== true) return;
          setBadges({
            notifications: toCount(j.notifications),
            offresDue: toCount(j.offresDue),
            poDue: toCount(j.poDue),
            inventaire: toCount(j.inventaire),
            incidents: toCount(j.incidents),
          });
        })
        .catch(() => {});
    };

    // L'évènement signale un CHANGEMENT réel → on force l'invalidation serveur.
    const onIncidentsChanged = () => load(true);

    load();
    const t = setInterval(() => load(), 60_000);
    window.addEventListener(RECEPTION_INCIDENTS_CHANGED, onIncidentsChanged);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener(RECEPTION_INCIDENTS_CHANGED, onIncidentsChanged);
    };
  }, []);

  return badges;
}
