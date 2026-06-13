"use client";

/**
 * Sync 2 écrans pour /pilotage — partage la granularité courante.
 * Pattern identique à [[consoleSync]] : BroadcastChannel + miroir localStorage.
 */

import type { Granularity } from "@/lib/pilotage";

export interface PilotageState {
  g: Granularity;
  at: number;
}

const CHANNEL = "televent-pilotage";
const STORAGE_KEY = "tv-pilotage-state";

export function broadcastPilotage(state: Omit<PilotageState, "at">) {
  if (typeof window === "undefined") return;
  const payload: PilotageState = { ...state, at: Date.now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: "state", payload });
    ch.close();
  } catch { /* fallback storage */ }
}

export function readPilotage(): PilotageState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PilotageState) : null;
  } catch { return null; }
}

export function subscribePilotage(cb: (s: PilotageState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      if (e.data?.type === "state" && e.data.payload) cb(e.data.payload as PilotageState);
      if (e.data?.type === "request") {
        const s = readPilotage();
        if (s) {
          try { const c = new BroadcastChannel(CHANNEL); c.postMessage({ type: "state", payload: s }); c.close(); } catch {}
        }
      }
    };
  } catch { /* fallback storage */ }
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) { try { cb(JSON.parse(e.newValue)); } catch {} }
  };
  window.addEventListener("storage", onStorage);
  return () => { ch?.close(); window.removeEventListener("storage", onStorage); };
}

export function requestPilotage() {
  if (typeof window === "undefined") return;
  try { const ch = new BroadcastChannel(CHANNEL); ch.postMessage({ type: "request" }); ch.close(); } catch {}
}
