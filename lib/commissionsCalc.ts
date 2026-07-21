/**
 * COMMISSIONS — cœur de calcul PUR (aucune I/O) : types, découpage mensuel et
 * sélection de la plage à payer. Séparé de lib/commissions (qui fait les
 * requêtes) pour être testable sans base — cf. lib/commissions.test.ts.
 */

export const PRIME_DEFAULT_RATE = 0.05;
export const PRIME_DEFAULT_START = new Date(Date.UTC(2025, 10, 1)); // 1ᵉʳ novembre 2025

export const r2 = (v: number) => Math.round(v * 100) / 100;
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export type DocTransportMode = "direct" | "grille" | "perkg" | "aucun";

export interface CommissionInvoice {
  slp: string;
  docEntry: number;
  docNum: number | null;
  docDate: Date;
  month: string;
  cardCode: string;
  cardName: string | null;
  caHt: number;
  margeBrute: number;
  cadeaux: number;
  kg: number;
  transport: number;
  carrier: string | null;
  mode: DocTransportMode;
  fromDoc: boolean;
  margeNette: number;
  plancher: boolean;
}

export interface CommissionCreditNote {
  slp: string;
  docEntry: number;
  docNum: number | null;
  docDate: Date;
  month: string;
  cardCode: string;
  cardName: string | null;
  caHt: number;
  margeBrute: number;
}

export interface CommissionMonth {
  month: string;              // YYYY-MM
  invoices: number;
  creditNotes: number;
  basePositive: number;
  avoirs: number;
  base: number;
  prime: number;
}

export interface PayslipCommission {
  slp: string;
  rate: number;
  base: number;
  prime: number;
  fromMonth: string;
  toMonth: string;
  monthsCount: number;
}

export function primeRateOf(cfg: Map<string, { rate: number; since: Date }>, slp: string): number {
  return cfg.get(slp)?.rate ?? PRIME_DEFAULT_RATE;
}

/**
 * Découpage MENSUEL (l'unité de paie) des documents d'UN commercial — mois
 * triés du plus récent au plus ancien. prime(mois) = taux × max(0, Σ max(0,
 * marge nette facture) − marge des avoirs). Mois négatif = 0 (pas de déficit).
 */
export function commissionMonths(
  invoices: CommissionInvoice[],
  creditNotes: CommissionCreditNote[],
  rate: number,
): CommissionMonth[] {
  const byMonth = new Map<string, { inv: number; cn: number; pos: number; avoirs: number }>();
  const bucket = (m: string) => {
    let b = byMonth.get(m);
    if (!b) { b = { inv: 0, cn: 0, pos: 0, avoirs: 0 }; byMonth.set(m, b); }
    return b;
  };
  for (const f of invoices) {
    const b = bucket(f.month);
    b.inv += 1;
    b.pos += Math.max(0, f.margeNette); // plancher 0 par facture
  }
  for (const n of creditNotes) {
    const b = bucket(n.month);
    b.cn += 1;
    b.avoirs += n.margeBrute;
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, b]) => {
      const base = Math.max(0, b.pos - b.avoirs); // pas de déficit reporté
      return {
        month,
        invoices: b.inv,
        creditNotes: b.cn,
        basePositive: r2(b.pos),
        avoirs: r2(b.avoirs),
        base: r2(base),
        prime: r2(base * rate),
      };
    });
}

/** Mois précédent (« 2026-01 » → « 2025-12 »). */
export function prevMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/**
 * Mois à RÉGLER sur la paie de `monthId` : la plage (curseur, monthId].
 * Le curseur effectif est borné au mois précédent → la paie du mois courant
 * garde toujours sa propre commission, même après avoir marqué ce mois réglé
 * (rectif). `paidThrough` null = rien réglé → tout l'arriéré ≤ monthId.
 */
export function selectPayslipMonths(
  months: CommissionMonth[],
  monthId: string,
  paidThrough: string | null,
): CommissionMonth[] {
  const prev = prevMonth(monthId);
  const cutoff = paidThrough ? (paidThrough < prev ? paidThrough : prev) : null;
  return months.filter((m) => m.month <= monthId && (cutoff === null || m.month > cutoff));
}
