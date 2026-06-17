"use client";

import { useEffect, useState } from "react";
import {
  broadcastPilotage, readPilotage, requestPilotage, subscribePilotage,
} from "@/lib/pilotageSync";
import type { Granularity } from "@/lib/pilotage";
import type { Segment } from "@/lib/segments";
import type { GeoPayload } from "@/lib/pilotageGeo";
import { isoWeek } from "@/lib/iso-week";

/* ─────────────────────────────────────────────────────────────────
   Hooks partagés entre Écran 1 (Activité BL) et Écran 2 (Annuel).
   ───────────────────────────────────────────────────────────────── */

export function useSharedGranularity(initial: Granularity = "week", role: "leader" | "follower" = "leader") {
  const [g, setG] = useState<Granularity>(initial);

  useEffect(() => {
    const prev = readPilotage();
    if (prev?.g) setG(prev.g);
    if (role === "follower") requestPilotage();
    const unsub = subscribePilotage((s) => { if (s.g) setG(s.g); });
    return unsub;
  }, [role]);

  function setShared(next: Granularity) {
    setG(next);
    broadcastPilotage({ g: next });
  }

  return [g, setShared] as const;
}

/* ─────────────────────────────────────────────────────────────────
   Écran 1 — Activité commerciale (BL / Orders).
   ───────────────────────────────────────────────────────────────── */

export interface ActivityPayload {
  granularity: Granularity;
  period: { start: string; end: string };
  previous: { start: string; end: string };
  curr: {
    volume: number; caProductNet: number; weightKg: number; margin: number; marginPct: number; marginCoverage: number;
    ordersCount: number; activeClients: number; avgBasket: number;
  };
  prev: {
    volume: number; caProductNet: number; weightKg: number; margin: number; marginPct: number; marginCoverage: number;
    ordersCount: number; activeClients: number; avgBasket: number;
  };
  crm: { appels: number; cdesCrm: number; tauxConv: number; clientsTouches: number };
  crmPrev: { appels: number; cdesCrm: number; tauxConv: number; clientsTouches: number };
  clients: { cardCode: string; cardName: string | null; volume: number; weightKg: number; orders: number; crmCalls: number }[];
  salespersons: { slpName: string; volume: number; weightKg: number; orders: number; activeClients: number }[];
}

/** Suffixe « voir comme » (impersonation admin) à ajouter aux requêtes pilotage. */
function asSuffix(as?: string | null): string {
  return as ? `&as=${encodeURIComponent(as)}` : "";
}

/** Ajoute `refresh=1` quand l'utilisateur a cliqué « Actualiser » (nonce > 0) —
 *  force le recalcul côté serveur (busting du cache hebdo/mémoire). */
function withRefresh(url: string, nonce: number): string {
  return nonce > 0 ? url + (url.includes("?") ? "&" : "?") + "refresh=1" : url;
}

export function useActivityData(g: Granularity, as?: string | null, nonce = 0) {
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetch(withRefresh(`/api/pilotage/activity?g=${g}${asSuffix(as)}`, nonce), { cache: "no-store" })
      .then((r) => r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText)))
      .then((j: ActivityPayload) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [g, as, nonce]);
  return { data, err };
}

/* ─────────────────────────────────────────────────────────────────
   Écran 2 — Rapport annuel (Invoices).
   ───────────────────────────────────────────────────────────────── */

export interface AnnualPayload {
  currentYear: number;
  matrix: {
    year: number;
    months: { ca: number; margin: number; weightKg: number; caProductNet: number }[];
    totalCa: number;
    totalMargin: number;
    totalWeightKg: number;
    totalCaProductNet: number;
  }[];
  clients: { cardCode: string; cardName: string | null; ca: number; caProductNet: number; margin: number; invoices: number; weightKg: number }[];
  suppliers: { cardCode: string; cardName: string | null; totalIn: number; pdnCount: number; weightKg: number }[];
  salespersons: { slpName: string; ca: number; caProductNet: number; margin: number; activeClients: number; invoices: number; weightKg: number }[];
}

export function useAnnualData(segment: Segment = "ALL", as?: string | null, nonce = 0) {
  const [data, setData] = useState<AnnualPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetch(withRefresh(`/api/pilotage/annual?segment=${segment}${asSuffix(as)}`, nonce), { cache: "no-store" })
      .then((r) => r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText)))
      .then((j: AnnualPayload) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [segment, as, nonce]);
  return { data, err };
}

/* ─────────────────────────────────────────────────────────────────
   Écran 1 — Série hebdomadaire du volume BL (Orders) par semaine ISO.
   Pour les courbes/sparklines du cockpit commercial.
   ───────────────────────────────────────────────────────────────── */

export interface ActivityWeeklyPayload {
  currentIsoYear: number;
  currentWeek: number;
  weeks: { isoYear: number; week: number; volume: number; weightKg: number }[];
}

export function useActivityWeekly(as?: string | null, nonce = 0) {
  const [data, setData] = useState<ActivityWeeklyPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(withRefresh(`/api/pilotage/activity/weekly${as ? `?as=${encodeURIComponent(as)}` : ""}`, nonce), { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((j: ActivityWeeklyPayload | null) => { if (!cancelled && j) setData(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [as, nonce]);
  return { data };
}

/* ─────────────────────────────────────────────────────────────────
   Écran 2 — Série hebdomadaire (Invoices) par semaine ISO.
   Évolution par n° de semaine + lookup « semaines à événement ».
   ───────────────────────────────────────────────────────────────── */

export interface WeeklyPayload {
  currentYear: number;
  currentIsoYear: number;
  currentWeek: number;
  weeks: { isoYear: number; week: number; ca: number; margin: number }[];
}

export function useWeeklyData(segment: Segment = "ALL", as?: string | null, nonce = 0) {
  const [data, setData] = useState<WeeklyPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetch(withRefresh(`/api/pilotage/weekly?segment=${segment}${asSuffix(as)}`, nonce), { cache: "no-store" })
      .then((r) => r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText)))
      .then((j: WeeklyPayload) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [segment, as, nonce]);
  return { data, err };
}

/* ─────────────────────────────────────────────────────────────────
   À relancer (actions) — réutilisé écran 2.
   ───────────────────────────────────────────────────────────────── */

export interface ActionsPayload {
  toRelance: {
    clientId: string; code: string; nom: string;
    commercial: string | null; lastInvoiceDays: number | null;
  }[];
}

export function useActionsData(as?: string | null) {
  const [data, setData] = useState<ActionsPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pilotage/actions${as ? `?as=${encodeURIComponent(as)}` : ""}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((j: ActionsPayload | null) => { if (!cancelled && j) setData(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [as]);
  return { data };
}

/* ─────────────────────────────────────────────────────────────────
   Écran 3 — Carte géographique (distribution du facturé, 12 mois glissants).
   ───────────────────────────────────────────────────────────────── */

export interface GeoPayloadClient extends GeoPayload {
  period: { start: string; end: string };
}

export function useGeoData(as?: string | null, nonce = 0) {
  const [data, setData] = useState<GeoPayloadClient | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetch(withRefresh(`/api/pilotage/geo${as ? `?as=${encodeURIComponent(as)}` : ""}`, nonce), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j: GeoPayloadClient) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [as, nonce]);
  return { data, err };
}

/* ─────────────────────────────────────────────────────────────────
   Libellé contextuel d'une période (utilisé sous chaque KPI au lieu du
   "12 mois glissants" trompeur — explicite la fenêtre.).
   ───────────────────────────────────────────────────────────────── */
export function granularityLabel(g: Granularity, ref = new Date()): string {
  if (g === "day") return ref.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (g === "week") {
    const d = new Date(ref);
    const dow = d.getDay();
    const start = new Date(d); start.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const { week } = isoWeek(d);
    return `S${String(week).padStart(2, "0")} · ${start.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} → ${end.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  }
  if (g === "month") return ref.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return String(ref.getFullYear());
}

/** Hint court à mettre sous un gros chiffre (ex: "Aujourd'hui", "Cette semaine"). */
export function granularityShortHint(g: Granularity): string {
  if (g === "day") return "Aujourd'hui";
  if (g === "week") return "Cette semaine";
  if (g === "month") return "Ce mois-ci";
  return "Cette année";
}
