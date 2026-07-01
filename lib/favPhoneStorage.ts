"use client";

/**
 * Numéro de téléphone FAVORI d'un client (console télévente). Le favori est le
 * numéro mis en avant (gros bouton jaune) sur la carte « Appeler ». À défaut de
 * favori, on garde le comportement historique (Standard = tel1 en premier).
 *
 * Persistance PAR CLIENT dans localStorage (clé `tv-favphone-<clientId>`),
 * propre au poste. 100% client, aucun changement de schéma/API ; sûr en SSR
 * (garde `typeof window`) et tolérant aux erreurs (mode privé / quota).
 */
export type PhoneKey = "tel1" | "tel2" | "tel3";

const PREFIX = "tv-favphone-";
const key = (clientId: string) => `${PREFIX}${clientId}`;
const isPhoneKey = (v: string | null): v is PhoneKey => v === "tel1" || v === "tel2" || v === "tel3";

/** Lit le numéro favori d'un client (`null` si aucun, SSR ou erreur). */
export function loadFavPhone(clientId: string | null | undefined): PhoneKey | null {
  if (!clientId || typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(key(clientId));
    return isPhoneKey(v) ? v : null;
  } catch {
    return null;
  }
}

/** Écrit (ou efface si `null`) le numéro favori d'un client. */
export function saveFavPhone(clientId: string | null | undefined, fav: PhoneKey | null): void {
  if (!clientId || typeof window === "undefined") return;
  try {
    if (fav) window.localStorage.setItem(key(clientId), fav);
    else window.localStorage.removeItem(key(clientId));
  } catch {
    /* ignore (mode privé / quota) */
  }
}
