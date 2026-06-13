/**
 * Behavioral insights — pure statistical analysis of a client's history.
 *
 * No LLM involved. Given the timestamps of all past actions, we compute:
 *   - best hour to call (highest order density)
 *   - best day of week
 *   - average interval between commandes
 *   - response rate (commandes / total)
 *   - recency: trend on the last 30 days vs the 30 days before
 *   - confidence: low (< 3 commandes) / medium / high
 *
 * These signals power the "Smart insights" card in the Console + client detail.
 */

interface AppelLite {
  type: "COMMANDE" | "DEMAIN" | string;
  heureAppel: Date | string;
}

export interface ClientInsights {
  ordersCount: number;            // total commandes ever
  callsCount: number;             // total appels ever
  conversionRate: number | null;  // 0..100 (null if too few)
  bestHour: { hour: number; share: number } | null;       // share = % of orders in this hour
  hourWindow: { start: number; end: number } | null;      // 1h window: [hour, hour+1)
  medianHour: number | null;      // median of order hours — used for sorting (robust to outliers)
  bestDayOfWeek: { dow: number; share: number } | null;   // 0=Sun..6=Sat
  medianIntervalDays: number | null; // median days between commandes (robust to outliers)
  lastOrderDays: number | null;   // days since last commande
  trend30: "rising" | "stable" | "falling" | null;        // last 30d vs prev 30d
  confidence: "low" | "medium" | "high";
  topHours: { hour: number; count: number }[];            // sorted desc, for visualization
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

export function computeInsights(appels: AppelLite[]): ClientInsights {
  const now = new Date();
  const orders = appels
    .filter((a) => a.type === "COMMANDE")
    .map((a) => new Date(a.heureAppel))
    .sort((a, b) => a.getTime() - b.getTime());

  const callsCount = appels.length;
  const ordersCount = orders.length;
  const conversionRate = callsCount > 0 ? Math.round((ordersCount / callsCount) * 100) : null;

  // ── Best hour (last 90d to keep it fresh) ──
  const last90 = new Date(now); last90.setDate(now.getDate() - 90);
  const recent = orders.filter((d) => d >= last90);
  const hourCounts: number[] = Array(24).fill(0);
  for (const d of recent) hourCounts[d.getHours()]++;
  const totalRecent = recent.length;

  let bestHour: ClientInsights["bestHour"] = null;
  let topHours: ClientInsights["topHours"] = [];
  let hourWindow: ClientInsights["hourWindow"] = null;
  let medianHour: ClientInsights["medianHour"] = null;
  if (totalRecent >= 3) {
    // Mode = most frequent hour (where the bar is highest)
    const sorted = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
    topHours = sorted.slice(0, 5);
    if (sorted.length > 0) {
      const top = sorted[0];
      bestHour = { hour: top.hour, share: Math.round((top.count / totalRecent) * 100) };
      // 1-hour window — e.g. bestHour=10 → "10h–11h"
      hourWindow = { start: top.hour, end: Math.min(23, top.hour + 1) };
    }

    // Median hour — used for sorting the queue (robust to outliers)
    const allHours = recent.map((d) => d.getHours()).sort((a, b) => a - b);
    const m = median(allHours);
    if (m !== null) medianHour = Math.round(m);
  }

  // ── Best day of week ──
  const dowCounts: number[] = Array(7).fill(0);
  for (const d of recent) dowCounts[d.getDay()]++;
  let bestDayOfWeek: ClientInsights["bestDayOfWeek"] = null;
  if (totalRecent >= 3) {
    let max = 0, bestDow = -1;
    for (let i = 0; i < 7; i++) if (dowCounts[i] > max) { max = dowCounts[i]; bestDow = i; }
    if (bestDow >= 0) {
      bestDayOfWeek = { dow: bestDow, share: Math.round((max / totalRecent) * 100) };
    }
  }

  // ── Median interval between commandes (robust to outliers) ──
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

  // ── Days since last commande ──
  let lastOrderDays: number | null = null;
  if (orders.length > 0) {
    const last = orders[orders.length - 1];
    lastOrderDays = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  }

  // ── Trend (last 30d vs prev 30d) ──
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

  // ── Confidence ──
  const confidence: ClientInsights["confidence"] =
    orders.length >= 10 ? "high" :
    orders.length >= 4  ? "medium" :
                          "low";

  return {
    ordersCount,
    callsCount,
    conversionRate,
    bestHour,
    hourWindow,
    medianHour,
    bestDayOfWeek,
    medianIntervalDays,
    lastOrderDays,
    trend30,
    confidence,
    topHours,
  };
}

/** Format a recommendation in natural French given the insights */
export function summaryRecommendation(i: ClientInsights): string | null {
  if (i.confidence === "low") return null;
  const parts: string[] = [];
  if (i.bestDayOfWeek && i.bestDayOfWeek.share >= 30) {
    parts.push(`${dayOfWeekLabel(i.bestDayOfWeek.dow).toLowerCase()}`);
  }
  if (i.hourWindow) {
    parts.push(`entre ${i.hourWindow.start}h et ${i.hourWindow.end}h`);
  } else if (i.bestHour) {
    parts.push(`vers ${i.bestHour.hour}h`);
  }
  if (parts.length === 0) return null;
  return `Idéal à appeler ${parts.join(", ")}.`;
}

/** Hour window label "8h–9h" */
export function hourWindowLabel(i: ClientInsights): string {
  if (i.hourWindow) return `${i.hourWindow.start}h–${i.hourWindow.end}h`;
  if (i.bestHour) return `${i.bestHour.hour}h`;
  return "—";
}
