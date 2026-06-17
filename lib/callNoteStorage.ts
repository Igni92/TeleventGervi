"use client";

/**
 * Persistance locale de la "note d'appel" en cours de frappe (console télévente).
 *
 * La note rapide saisie pour le client actif est volatile : un simple refresh de
 * page la perdait. On la persiste donc PAR CLIENT dans localStorage (clé
 * `tv-callnote-<clientId>`), pour la restaurer quand le client redevient actif,
 * et on l'efface dès qu'une action est journalisée (commande / à demain / …).
 *
 * 100% client, aucun changement de schéma/API. Toutes les opérations sont
 * sûres en SSR (gardes `typeof window`) et tolérantes aux erreurs (mode privé,
 * quota dépassé, etc.) — en cas d'échec on dégrade silencieusement vers le
 * comportement actuel (note non persistée).
 */

const PREFIX = "tv-callnote-";

const key = (clientId: string) => `${PREFIX}${clientId}`;

/** Lit la note persistée pour un client (`""` si absente, SSR ou erreur). */
export function loadCallNote(clientId: string | null | undefined): string {
  if (!clientId || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key(clientId)) ?? "";
  } catch {
    return "";
  }
}

/**
 * Écrit (ou efface si vide) la note d'un client. Une note vide ne laisse pas
 * d'entrée résiduelle dans le storage.
 */
export function saveCallNote(clientId: string | null | undefined, note: string): void {
  if (!clientId || typeof window === "undefined") return;
  try {
    if (note.trim()) {
      window.localStorage.setItem(key(clientId), note);
    } else {
      window.localStorage.removeItem(key(clientId));
    }
  } catch {
    /* ignore (mode privé / quota) */
  }
}

/** Supprime la note persistée d'un client (après journalisation d'une action). */
export function clearCallNote(clientId: string | null | undefined): void {
  if (!clientId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(clientId));
  } catch {
    /* ignore */
  }
}
