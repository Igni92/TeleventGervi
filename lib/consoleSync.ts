"use client";

/**
 * Synchronisation temps réel entre l'écran principal (console) et l'écran 2
 * (stock + BL) via BroadcastChannel + miroir localStorage (init au chargement).
 *
 * L'écran 1 diffuse le client actif ; l'écran 2 s'y abonne et suit automatiquement.
 */

export interface ActiveClientInfo {
  code: string | null;
  type: string | null;
  commercial: string | null;
  tel1: string | null;
  tel2: string | null;
  tel3: string | null;
  email: string | null;
  sapGroupCode: number | null;
  sapGroupName: string | null;
  notes: string | null;
  /** CSV "1,3,5" (Lun=1 … Dim=0) — jours d'appel programmés. */
  joursAppel: string | null;
  /** Incidents BL ouverts (non résolus). */
  openIncidents: number | null;
  /** Délai en jours depuis la dernière commande. */
  lastOrderDays: number | null;
  /** Nb de commandes CRM (logs) sur la fenêtre d'historique. */
  ordersCount: number | null;
  /** Heure médiane optimale d'appel (0–23). */
  medianHour: number | null;
  /** Meilleur jour de la semaine (0=dim … 6=sam). */
  bestDayOfWeek: number | null;
  /** Tendance commandes 30j vs 30j précédents. */
  trend30: "rising" | "falling" | "stable" | null;
}
export interface ActiveClientState {
  clientId: string | null;
  clientName: string | null;
  stockSharePct: number;
  client?: ActiveClientInfo | null;
  at: number;
}

const CHANNEL = "televent-console";
const STORAGE_KEY = "tv-console-active";

/** Supprime le miroir local du client actif (contient des PII : tel, email,
 *  notes). À appeler quand la console se ferme pour ne RIEN laisser en clair
 *  sur un poste partagé. */
export function clearActiveClient() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// Purge automatique à la fermeture de l'onglet/fenêtre (poste partagé) : le
// miroir localStorage ne doit pas survivre à la session de travail. `pagehide`
// couvre fermeture + navigation + bfcache (plus fiable que beforeunload).
let unloadHooked = false;
function hookUnloadPurge() {
  if (unloadHooked || typeof window === "undefined") return;
  unloadHooked = true;
  window.addEventListener("pagehide", clearActiveClient);
}

/** Diffuse l'état du client actif (écran 1) + persiste pour l'init de l'écran 2. */
export function broadcastActiveClient(state: Omit<ActiveClientState, "at">) {
  if (typeof window === "undefined") return;
  hookUnloadPurge();
  const payload: ActiveClientState = { ...state, at: Date.now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: "active", payload });
    ch.close();
  } catch { /* BroadcastChannel non supporté → fallback localStorage event */ }
}

/** Lit le dernier état connu (pour initialiser l'écran 2 au chargement). */
export function readActiveClient(): ActiveClientState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActiveClientState) : null;
  } catch { return null; }
}

/**
 * S'abonne aux changements de client actif. Renvoie une fonction de désabonnement.
 * Écoute BroadcastChannel ET l'event storage (multi-fenêtres robuste).
 */
export function subscribeActiveClient(cb: (s: ActiveClientState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      if (e.data?.type === "active" && e.data.payload) cb(e.data.payload as ActiveClientState);
      if (e.data?.type === "request") {
        // L'écran 2 demande l'état courant → on rediffuse le dernier connu
        const s = readActiveClient();
        if (s) { try { const c = new BroadcastChannel(CHANNEL); c.postMessage({ type: "active", payload: s }); c.close(); } catch {} }
      }
    };
  } catch { /* fallback storage uniquement */ }
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) { try { cb(JSON.parse(e.newValue)); } catch {} }
  };
  window.addEventListener("storage", onStorage);
  return () => { ch?.close(); window.removeEventListener("storage", onStorage); };
}

/** Demande l'état courant (utilisé par l'écran 2 au chargement). */
export function requestActiveClient() {
  if (typeof window === "undefined") return;
  try { const ch = new BroadcastChannel(CHANNEL); ch.postMessage({ type: "request" }); ch.close(); } catch { /* ignore */ }
}
