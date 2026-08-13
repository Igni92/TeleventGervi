/**
 * MOTEUR DE RÈGLES DE COMMISSION — configurable par commercial.
 *
 * Chaque commercial a une LISTE ORDONNÉE de règles « SI … ALORS … ». Pour CHAQUE
 * client du commercial, on évalue les règles dans l'ordre et la PREMIÈRE dont la
 * condition est vraie l'emporte (sinon le client n'est pas commissionné). La
 * condition porte sur une métrique CUMULÉE par client depuis la date de début de
 * prime (`since`) : volume livré (kg) ou chiffre d'affaires HT. L'action définit
 * la commission de ce client : % de sa marge nette, % de son CA HT, ou prime fixe.
 *
 * Rétroactif : tout est recalculé en direct depuis SAP à chaque lecture (comme le
 * seuil kg). Stockage JSON par commercial dans AppSetting (`commrules:<slp>`),
 * indépendant de `CommercialPrime` (rate/since/seuilKg restent la config de base
 * ET la règle PAR DÉFAUT quand aucune règle explicite n'est posée).
 *
 * ADDITIF / rétrocompatible : sans règle explicite, le calcul reste EXACTEMENT
 * celui de lib/commissions (seuil kg + taux unique). Cf. commissionMonths.
 */
import { prisma } from "@/lib/prisma";
import {
  r2, type CommissionInvoice, type CommissionCreditNote, type CommissionMonth,
} from "@/lib/commissionsCalc";

/** Métrique de condition — cumulée PAR CLIENT depuis `since`. */
export type RuleMetric = "volume_kg" | "caht";
/** Action = comment est calculée la commission du client qui remplit la condition. */
export type RuleAction = "rate_marge" | "rate_caht" | "fixed";

export interface CommissionRule {
  id: string;
  metric: RuleMetric;
  /** Seuil de déclenchement (kg pour volume_kg, € pour caht). Client qualifié si métrique ≥ seuil. */
  threshold: number;
  action: RuleAction;
  /** Taux (fraction 0–1) pour rate_*, montant € pour fixed. */
  value: number;
}

const RULES_PREFIX = "commrules:";

const num = (v: unknown, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : 0;
};

/** Nettoie une règle brute (entrée UI / JSON stocké). Renvoie null si invalide. */
export function sanitizeRule(raw: unknown, id: string): CommissionRule | null {
  const r = (raw ?? {}) as Partial<CommissionRule>;
  const metric: RuleMetric = r.metric === "caht" ? "caht" : "volume_kg";
  const action: RuleAction =
    r.action === "rate_caht" ? "rate_caht" : r.action === "fixed" ? "fixed" : "rate_marge";
  const threshold = num(r.threshold);
  // Taux borné à [0,1] pour les actions en %, montant libre ≥ 0 pour la prime fixe.
  const value = action === "fixed" ? num(r.value) : Math.min(1, num(r.value));
  return { id: id || (typeof r.id === "string" ? r.id : ""), metric, threshold, action, value };
}

export function sanitizeRules(raw: unknown): CommissionRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x, i) => sanitizeRule(x, (x as { id?: string })?.id || `r${i}`))
    .filter((r): r is CommissionRule => !!r && !!r.id);
}

/**
 * Règle PAR DÉFAUT dérivée de CommercialPrime quand aucune règle explicite : elle
 * reproduit le comportement historique (SI volume ≥ seuil ALORS taux % marge nette).
 * `id` fixe « default » pour que l'UI la distingue d'une règle saisie.
 */
export function defaultRule(seuilKg: number, rate: number): CommissionRule {
  return { id: "default", metric: "volume_kg", threshold: Math.max(0, seuilKg), action: "rate_marge", value: rate };
}

/** True si ces règles sont juste la règle par défaut (⇒ on peut prendre le chemin hérité exact). */
export function isDefaultOnly(rules: CommissionRule[]): boolean {
  return rules.length === 1 && rules[0].id === "default";
}

/** Première règle dont la condition est remplie pour ce client, sinon null. */
export function winningRuleFor(
  rules: CommissionRule[],
  metrics: { kg: number; caht: number },
): CommissionRule | null {
  for (const r of rules) {
    const v = r.metric === "volume_kg" ? metrics.kg : metrics.caht;
    if (v >= r.threshold) return r;
  }
  return null;
}

/* ─────────────────────────────── Libellés FR ────────────────────────────── */
const eur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const pct = (v: number) => `${r2(v * 100)} %`;

export function describeCondition(r: Pick<CommissionRule, "metric" | "threshold">): string {
  return r.metric === "volume_kg" ? `volume ≥ ${r.threshold} kg` : `CA HT ≥ ${eur(r.threshold)}`;
}
export function describeAction(r: Pick<CommissionRule, "action" | "value">): string {
  return r.action === "rate_marge"
    ? `${pct(r.value)} de la marge nette`
    : r.action === "rate_caht"
      ? `${pct(r.value)} du CA HT`
      : `prime fixe ${eur(r.value)}`;
}
export function describeRule(r: CommissionRule): string {
  return `SI ${describeCondition(r)} ALORS ${describeAction(r)}`;
}

/* ───────────────────────────── Persistance (AppSetting) ──────────────────── */

export async function loadAllCommissionRules(): Promise<Map<string, CommissionRule[]>> {
  const out = new Map<string, CommissionRule[]>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: RULES_PREFIX } } });
    for (const row of rows) {
      const slp = row.key.slice(RULES_PREFIX.length);
      if (!slp) continue;
      const rules = sanitizeRules(JSON.parse(row.value));
      if (rules.length) out.set(slp, rules);
    }
  } catch { /* table absente / JSON cassé → aucune règle */ }
  return out;
}

export async function loadCommissionRules(slp: string): Promise<CommissionRule[]> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: `${RULES_PREFIX}${slp}` } });
    return row ? sanitizeRules(JSON.parse(row.value)) : [];
  } catch { return []; }
}

export async function saveCommissionRules(slp: string, rawRules: unknown): Promise<CommissionRule[]> {
  const rules = sanitizeRules(rawRules);
  const key = `${RULES_PREFIX}${slp}`;
  if (rules.length === 0) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return [];
  }
  const value = JSON.stringify(rules);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return rules;
}

/* ───────────────────────── Calcul mensuel PAR RÈGLES ─────────────────────── */

/** Métrique cumulée d'un client (sur la fenêtre `since`, déjà appliquée en amont). */
export interface ClientMetric {
  slp: string;
  cardCode: string;
  cardName: string | null;
  kg: number;
  caht: number;
}

/** Avancement d'un client vis-à-vis de la première règle non encore atteinte. */
export interface ClientProgress extends ClientMetric {
  /** Règle qui commissionne actuellement ce client (null = aucune). */
  winning: CommissionRule | null;
  /** Prochaine règle à atteindre (la plus proche non remplie), pour la barre d'avancement. */
  next: CommissionRule | null;
  /** Ratio 0–1 vers `next` (ou 1 si déjà qualifié). */
  ratio: number;
}

/**
 * Découpage MENSUEL par RÈGLES : pour chaque client on choisit la règle gagnante
 * (selon ses métriques cumulées), puis on applique son action document par document,
 * agrégé par (client, mois) — plancher 0 par (client, mois), pas de déficit reporté.
 * Une prime FIXE est comptée UNE fois, imputée au mois de la facture la plus récente
 * du client. Renvoie le même type que commissionMonths (dueCumul = Σ prime).
 */
export function commissionMonthsRuled(
  invoices: CommissionInvoice[],
  creditNotes: CommissionCreditNote[],
  rules: CommissionRule[],
  metricByClient: Map<string, { kg: number; caht: number }>,
): CommissionMonth[] {
  // Agrégat par (client, mois).
  type Cell = { inv: number; cn: number; pos: number; caht: number; avoirMarge: number; avoirCaht: number };
  const cells = new Map<string, Cell>(); // key = `${card}|${month}`
  const cell = (card: string, m: string) => {
    const k = `${card}|${m}`;
    let c = cells.get(k);
    if (!c) { c = { inv: 0, cn: 0, pos: 0, caht: 0, avoirMarge: 0, avoirCaht: 0 }; cells.set(k, c); }
    return c;
  };
  const lastMonthByClient = new Map<string, string>();
  for (const f of invoices) {
    const c = cell(f.cardCode, f.month);
    c.inv += 1; c.pos += Math.max(0, f.margeNette); c.caht += f.caHt;
    const prev = lastMonthByClient.get(f.cardCode);
    if (!prev || f.month > prev) lastMonthByClient.set(f.cardCode, f.month);
  }
  for (const n of creditNotes) {
    const c = cell(n.cardCode, n.month);
    c.cn += 1; c.avoirMarge += n.margeBrute; c.avoirCaht += n.caHt;
  }

  const rule = (card: string) => winningRuleFor(rules, metricByClient.get(card) ?? { kg: 0, caht: 0 });

  const byMonth = new Map<string, { inv: number; cn: number; base: number; prime: number }>();
  const monthBucket = (m: string) => {
    let b = byMonth.get(m);
    if (!b) { b = { inv: 0, cn: 0, base: 0, prime: 0 }; byMonth.set(m, b); }
    return b;
  };

  for (const [k, c] of cells) {
    const card = k.slice(0, k.lastIndexOf("|"));
    const month = k.slice(k.lastIndexOf("|") + 1);
    const w = rule(card);
    const b = monthBucket(month);
    b.inv += c.inv; b.cn += c.cn;
    if (!w || w.action === "fixed") continue; // fixe traité plus bas
    if (w.action === "rate_marge") {
      const base = Math.max(0, c.pos - c.avoirMarge);
      b.base += base; b.prime += base * w.value;
    } else { // rate_caht
      const base = Math.max(0, c.caht - c.avoirCaht);
      b.base += base; b.prime += base * w.value;
    }
  }

  // Primes FIXES : une fois par client qualifié, sur le mois de sa dernière facture.
  for (const [card, m] of lastMonthByClient) {
    const w = rule(card);
    if (w && w.action === "fixed") monthBucket(m).prime += w.value;
  }

  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, b]) => ({
      month,
      invoices: b.inv,
      creditNotes: b.cn,
      basePositive: r2(b.base),
      avoirs: 0,
      base: r2(b.base),
      prime: r2(b.prime),
    }));
}

/** Construit l'avancement par client (pour l'état « où en sont mes clients »). */
export function clientProgressList(
  metrics: ClientMetric[],
  rules: CommissionRule[],
): ClientProgress[] {
  return metrics
    .map((m) => {
      const winning = winningRuleFor(rules, { kg: m.kg, caht: m.caht });
      // Prochaine règle à atteindre = la 1re non remplie avec le plus petit « reste ».
      let next: CommissionRule | null = null;
      let bestRatio = 0;
      for (const r of rules) {
        const v = r.metric === "volume_kg" ? m.kg : m.caht;
        if (v >= r.threshold) continue;
        const ratio = r.threshold > 0 ? v / r.threshold : 1;
        if (ratio >= bestRatio) { bestRatio = ratio; next = r; }
      }
      return { ...m, winning, next, ratio: winning ? 1 : bestRatio };
    })
    .sort((a, b) => b.ratio - a.ratio);
}
