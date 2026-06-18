/**
 * Mise au NET de l'encours d'un client — NT-2026-RC-01 / grand livre tiers.
 *
 * L'encours « brut » (somme des factures ouvertes, DocTotal − PaidToDate) ne
 * déduit PAS les règlements/avoirs reçus mais non encore affectés (rapprochés).
 * Le vrai dû = solde net du compte tiers (SAP CurrentAccountBalance) = le SOLDE
 * du grand livre. On soustrait donc l'encaissé non affecté, alloué aux tranches
 * d'ancienneté les PLUS ANCIENNES d'abord (FIFO : un règlement solde d'abord la
 * dette la plus vieille → on ne relance pas du déjà payé).
 *
 * Fonction PURE (testable). Montants en euros.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface NetEncours {
  /** Encours NET dû (= solde compte tiers, borné à [0, total factures]). */
  net: number;
  /** Encaissé non affecté déduit du brut. */
  encaisse: number;
  /** Tranches d'ancienneté NETTES (après allocation FIFO de l'encaissé). */
  b3045: number;
  b4590: number;
  b90: number;
}

export function netEncours(args: {
  /** Encours brut = somme des soldes des factures ouvertes. */
  openTotal: number;
  b3045: number;
  b4590: number;
  b90: number;
  /** Solde net du compte tiers (CurrentAccountBalance). null → pas de mise au net. */
  currentAccountBalance: number | null | undefined;
}): NetEncours {
  const { openTotal, currentAccountBalance } = args;
  const net =
    currentAccountBalance == null
      ? round2(openTotal)
      : round2(Math.max(0, Math.min(openTotal, currentAccountBalance)));
  const encaisse = round2(openTotal - net);

  // Alloue l'encaissé aux tranches anciennes d'abord (>90 → 45-90 → 30-45) ;
  // le reliquat éventuel réduit la part non échue (non suivie en tranche).
  let rem = encaisse;
  const cut = (v: number) => {
    const d = Math.min(v, rem);
    rem = round2(rem - d);
    return round2(v - d);
  };
  const b90 = cut(args.b90);
  const b4590 = cut(args.b4590);
  const b3045 = cut(args.b3045);

  return { net, encaisse, b3045, b4590, b90 };
}
