/**
 * Behavioral insights — pure statistical analysis of a client's history.
 *
 * No LLM involved. Given the timestamps + outcomes of all past actions, we compute:
 *   - **pickup analysis** : à quel créneau (30 min) le client DÉCROCHE le plus
 *     (taux de décroché = décrochés / tentatives) — c'est le vrai « quand
 *     appeler », robuste au biais « heure où l'agent a saisi ».
 *   - best hour to order (order density) — conservé pour info
 *   - best day of week
 *   - median interval between commandes
 *   - conversion rate (commandes / total)
 *   - recency: trend on the last 30 days vs the 30 days before
 *   - cadence status (en retard vs fréquence habituelle)
 *   - confidence: low / medium / high
 *
 * IMPORTANT — fuseau : ces stats sont calculées **côté serveur** (UTC). Toute
 * extraction d'heure/jour passe par les helpers Europe/Paris (cf. lib/paris-time)
 * sinon l'heure affichée ET le tri de la file dérivent de 1–2 h.
 */

import { parisHourMinute, parisDayOfWeek } from "./paris-time";

export type Outcome =
  | "COMMANDE" | "DEMAIN" | "NRP" | "REFUS" | "REPONDEUR" | "LITIGE" | "RAPPELE";

interface AppelLite {
  type: "COMMANDE" | "DEMAIN" | string;
  /** Issue détaillée (#41). Absent sur l'historique legacy → dérivé de `type`. */
  outcome?: string | null;
  heureAppel: Date | string;
}

/** Issues qui prouvent que quelqu'un a DÉCROCHÉ (contact humain établi). */
const CONNECTED: ReadonlySet<string> = new Set([
  "COMMANDE", "DEMAIN", "REFUS", "RAPPELE", "LITIGE",
]);
/** Issues « personne au bout du fil ». */
const NOT_CONNECTED: ReadonlySet<string> = new Set(["NRP", "REPONDEUR"]);

/** Issue effective d'un appel : `outcome` si présent, sinon dérivé de `type`
 *  (historique legacy — les seuls types étaient COMMANDE/DEMAIN, tous deux
 *  = contact établi). */
function effectiveOutcome(a: AppelLite): string {
  return (a.outcome && a.outcome.trim()) || a.type;
}
function isConnected(a: AppelLite): boolean {
  return CONNECTED.has(effectiveOutcome(a));
}
function isCountedAttempt(a: AppelLite): boolean {
  const o = effectiveOutcome(a);
  return CONNECTED.has(o) || NOT_CONNECTED.has(o);
}

export interface PickupSlot {
  hour: number;            // 0..23 (début du créneau)
  minute: number;          // 0 ou 30
  rate: number;            // taux de décroché 0..100
  attempts: number;        // tentatives loggées sur ce créneau
  granularity: "30min" | "hour";
}

export interface ClientInsights {
  ordersCount: number;            // total commandes ever
  callsCount: number;             // total appels ever
  conversionRate: number | null;  // 0..100 (null if too few)

  // ── Décroché (le signal demandé) ──
  attemptsCount: number;          // tentatives exploitables (avec issue connue)
  connectedCount: number;         // dont décrochés
  answerRate: number | null;      // 0..100 taux de décroché global
  bestPickup: PickupSlot | null;  // meilleur créneau pour JOINDRE le client
  pickupByHour: { hour: number; attempts: number; connected: number; rate: number }[];

  // ── Commande (densité) — conservé, désormais en heure de Paris ──
  bestHour: { hour: number; share: number } | null;
  hourWindow: { start: number; end: number } | null;
  medianHour: number | null;

  // ── Heure recommandée pour appeler (décroché prioritaire, repli densité) ──
  recommendedHour: number | null; // sert au tri de la file

  bestDayOfWeek: { dow: number; share: number } | null;
  medianIntervalDays: number | null;
  lastOrderDays: number | null;
  cadenceStatus: "overdue" | "due" | "ok" | null; // en retard vs fréquence habituelle
  trend30: "rising" | "stable" | "falling" | null;
  confidence: "low" | "medium" | "high";
  topHours: { hour: number; count: number }[];
}

/** Median of a sorted array of numbers. Median > mean for skewed data. */
function median(sortedNums: number[]): number | null {
  if (sortedNums.length === 0) return null;
  const mid = Math.floor(sortedNums.length / 2);
  if (sortedNums.length % 2 === 0) {
    return (sortedNums[mid - 1] + sortedNums[mid]) / 2;
  }
  return sortedNums[mid];
}

const DOW_FR: Record<number, string> = {
  0: "Dimanche", 1: "Lundi", 2: "Mardi", 3: "Mercredi",
  4: "Jeudi", 5: "Vendredi", 6: "Samedi",
};

export function dayOfWeekLabel(dow: number): string {
  return DOW_FR[dow] ?? "?";
}

// Seuils d'analyse du décroché.
const MIN_ATTEMPTS_TOTAL = 4;  // en-dessous : pas de reco de créneau fiable
const MIN_ATTEMPTS_SLOT = 3;   // créneau 30 min crédible
const MIN_ATTEMPTS_HOUR = 3;   // repli à l'heure pleine

export function computeInsights(appels: AppelLite[]): ClientInsights {
  const now = new Date();
  const orders = appels
    .filter((a) => a.type === "COMMANDE")
    .map((a) => new Date(a.heureAppel))
    .sort((a, b) => a.getTime() - b.getTime());

  const callsCount = appels.length;
  const ordersCount = orders.length;
  const conversionRate = callsCount > 0 ? Math.round((ordersCount / callsCount) * 100) : null;

  const last90 = new Date(now); last90.setDate(now.getDate() - 90);

  // ══ Analyse du DÉCROCHÉ (créneaux 30 min, heure de Paris) ══
  // On compte TOUTES les tentatives dont on connaît l'issue (pas seulement les
  // commandes) : décroché / non décroché par créneau → taux de décroché.
  const attempts48 = Array(48).fill(0) as number[]; // index = hour*2 + (minute>=30)
  const connected48 = Array(48).fill(0) as number[];
  let attemptsCount = 0;
  let connectedCount = 0;
  for (const a of appels) {
    if (!isCountedAttempt(a)) continue;
    const d = new Date(a.heureAppel);
    if (d < last90) continue;
    const { hour, minute } = parisHourMinute(d);
    const slot = hour * 2 + (minute >= 30 ? 1 : 0);
    attempts48[slot]++;
    attemptsCount++;
    if (isConnected(a)) { connected48[slot]++; connectedCount++; }
  }
  const answerRate = attemptsCount > 0 ? Math.round((connectedCount / attemptsCount) * 100) : null;

  // Meilleur créneau pour JOINDRE : d'abord à 30 min si assez de tentatives,
  // sinon repli à l'heure pleine (plus de données → plus robuste).
  let bestPickup: PickupSlot | null = null;
  if (attemptsCount >= MIN_ATTEMPTS_TOTAL) {
    // 30 min
    let best = -1, bestRate = -1, bestAtt = 0;
    for (let s = 0; s < 48; s++) {
      if (attempts48[s] < MIN_ATTEMPTS_SLOT) continue;
      const rate = connected48[s] / attempts48[s];
      if (rate > bestRate || (rate === bestRate && attempts48[s] > bestAtt)) {
        best = s; bestRate = rate; bestAtt = attempts48[s];
      }
    }
    if (best >= 0) {
      bestPickup = {
        hour: Math.floor(best / 2), minute: best % 2 === 0 ? 0 : 30,
        rate: Math.round(bestRate * 100), attempts: attempts48[best], granularity: "30min",
      };
    } else {
      // Repli heure pleine
      const attH = Array(24).fill(0) as number[];
      const conH = Array(24).fill(0) as number[];
      for (let s = 0; s < 48; s++) { const h = Math.floor(s / 2); attH[h] += attempts48[s]; conH[h] += connected48[s]; }
      let bh = -1, bhRate = -1, bhAtt = 0;
      for (let h = 0; h < 24; h++) {
        if (attH[h] < MIN_ATTEMPTS_HOUR) continue;
        const rate = conH[h] / attH[h];
        if (rate > bhRate || (rate === bhRate && attH[h] > bhAtt)) { bh = h; bhRate = rate; bhAtt = attH[h]; }
      }
      if (bh >= 0) {
        bestPickup = { hour: bh, minute: 0, rate: Math.round(bhRate * 100), attempts: attH[bh], granularity: "hour" };
      }
    }
  }

  // Visualisation : taux de décroché par heure (heures avec ≥1 tentative).
  const pickupByHour: ClientInsights["pickupByHour"] = [];
  {
    const attH = Array(24).fill(0) as number[];
    const conH = Array(24).fill(0) as number[];
    for (let s = 0; s < 48; s++) { const h = Math.floor(s / 2); attH[h] += attempts48[s]; conH[h] += connected48[s]; }
    for (let h = 0; h < 24; h++) {
      if (attH[h] > 0) pickupByHour.push({ hour: h, attempts: attH[h], connected: conH[h], rate: Math.round((conH[h] / attH[h]) * 100) });
    }
  }

  // ══ Best hour de COMMANDE (densité) — heure de Paris ══
  const recent = orders.filter((d) => d >= last90);
  const hourCounts: number[] = Array(24).fill(0);
  for (const d of recent) hourCounts[parisHourMinute(d).hour]++;
  const totalRecent = recent.length;

  let bestHour: ClientInsights["bestHour"] = null;
  let topHours: ClientInsights["topHours"] = [];
  let hourWindow: ClientInsights["hourWindow"] = null;
  let medianHour: ClientInsights["medianHour"] = null;
  if (totalRecent >= 3) {
    const sorted = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
    topHours = sorted.slice(0, 5);
    if (sorted.length > 0) {
      const top = sorted[0];
      bestHour = { hour: top.hour, share: Math.round((top.count / totalRecent) * 100) };
      hourWindow = { start: top.hour, end: Math.min(23, top.hour + 1) };
    }
    const allHours = recent.map((d) => parisHourMinute(d).hour).sort((a, b) => a - b);
    const m = median(allHours);
    if (m !== null) medianHour = Math.round(m);
  }

  // Heure recommandée pour APPELER : décroché prioritaire (c'est le but),
  // repli sur la densité de commande, puis médiane.
  const recommendedHour: number | null =
    bestPickup?.hour ?? bestHour?.hour ?? medianHour ?? null;

  // ══ Best day of week (Paris) ══
  const dowCounts: number[] = Array(7).fill(0);
  for (const d of recent) dowCounts[parisDayOfWeek(d)]++;
  let bestDayOfWeek: ClientInsights["bestDayOfWeek"] = null;
  if (totalRecent >= 3) {
    let max = 0, bestDow = -1;
    for (let i = 0; i < 7; i++) if (dowCounts[i] > max) { max = dowCounts[i]; bestDow = i; }
    if (bestDow >= 0) {
      bestDayOfWeek = { dow: bestDow, share: Math.round((max / totalRecent) * 100) };
    }
  }

  // ══ Median interval between commandes ══
  let medianIntervalDays: number | null = null;
  if (orders.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < orders.length; i++) {
      const diffMs = orders[i].getTime() - orders[i - 1].getTime();
      intervals.push(diffMs / (1000 * 60 * 60 * 24));
    }
    intervals.sort((a, b) => a - b);
    const m = median(intervals);
    if (m !== null) medianIntervalDays = Math.round(m);
  }

  // ══ Days since last commande ══
  let lastOrderDays: number | null = null;
  if (orders.length > 0) {
    const last = orders[orders.length - 1];
    lastOrderDays = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  }

  // ══ Cadence : en retard vs fréquence habituelle de commande ══
  let cadenceStatus: ClientInsights["cadenceStatus"] = null;
  if (medianIntervalDays !== null && lastOrderDays !== null && medianIntervalDays > 0) {
    if (lastOrderDays >= medianIntervalDays * 1.5) cadenceStatus = "overdue";
    else if (lastOrderDays >= medianIntervalDays) cadenceStatus = "due";
    else cadenceStatus = "ok";
  }

  // ══ Trend (last 30d vs prev 30d) ══
  const last30 = new Date(now); last30.setDate(now.getDate() - 30);
  const prev60 = new Date(now); prev60.setDate(now.getDate() - 60);
  const recent30 = orders.filter((d) => d >= last30).length;
  const prev30 = orders.filter((d) => d >= prev60 && d < last30).length;
  let trend30: ClientInsights["trend30"] = null;
  if (orders.length >= 2) {
    if (recent30 > prev30) trend30 = "rising";
    else if (recent30 < prev30) trend30 = "falling";
    else trend30 = "stable";
  }

  const confidence: ClientInsights["confidence"] =
    orders.length >= 10 ? "high" :
    orders.length >= 4  ? "medium" :
                          "low";

  return {
    ordersCount, callsCount, conversionRate,
    attemptsCount, connectedCount, answerRate, bestPickup, pickupByHour,
    bestHour, hourWindow, medianHour, recommendedHour,
    bestDayOfWeek, medianIntervalDays, lastOrderDays, cadenceStatus,
    trend30, confidence, topHours,
  };
}

/** Libellé d'un créneau de décroché : « 14h–14h30 » (30 min) ou « 14h–15h » (heure). */
export function pickupSlotLabel(s: PickupSlot): string {
  const start = s.minute === 30 ? `${s.hour}h30` : `${s.hour}h`;
  if (s.granularity === "30min") {
    return s.minute === 30 ? `${start}–${s.hour + 1}h` : `${start}–${s.hour}h30`;
  }
  return `${s.hour}h–${Math.min(24, s.hour + 1)}h`;
}

/** Format a recommendation in natural French given the insights */
export function summaryRecommendation(i: ClientInsights): string | null {
  const parts: string[] = [];
  // Décroché prioritaire : c'est l'info la plus actionnable pour joindre.
  if (i.bestPickup) {
    parts.push(`décroche surtout ${pickupSlotLabel(i.bestPickup)}`);
  } else {
    if (i.confidence === "low") return null;
    if (i.bestDayOfWeek && i.bestDayOfWeek.share >= 30) {
      parts.push(`${dayOfWeekLabel(i.bestDayOfWeek.dow).toLowerCase()}`);
    }
    if (i.hourWindow) parts.push(`entre ${i.hourWindow.start}h et ${i.hourWindow.end}h`);
    else if (i.bestHour) parts.push(`vers ${i.bestHour.hour}h`);
  }
  if (parts.length === 0) return null;
  return `Idéal à appeler : ${parts.join(", ")}.`;
}

/** Hour window label "8h–9h" — repli sur le créneau de décroché s'il existe. */
export function hourWindowLabel(i: ClientInsights): string {
  if (i.bestPickup) return pickupSlotLabel(i.bestPickup);
  if (i.hourWindow) return `${i.hourWindow.start}h–${i.hourWindow.end}h`;
  if (i.bestHour) return `${i.bestHour.hour}h`;
  return "—";
}
