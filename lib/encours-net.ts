/**
 * Mise au NET de l'encours d'un client — NT-2026-RC-01 / grand livre tiers.
 *
 * L'encours « brut » (somme des factures ouvertes, DocTotal − PaidToDate) ne
 * déduit PAS les règlements/avoirs reçus mais non encore affectés. Le vrai dû =
 * solde net du compte tiers (SAP CurrentAccountBalance) = le SOLDE du grand
 * livre. On calcule donc le NET et le montant ENCAISSÉ à déduire.
 *
 * ⚠️ On ne répartit PAS l'encaissé/les avoirs sur des factures précises : un
 * avoir peut être affecté à une autre facture que celle qu'on devinerait. La
 * déduction est donc présentée comme UNE LIGNE globale (brut − encaissé = net),
 * factures et tranches d'ancienneté restant au BRUT.
 *
 * Fonction PURE (testable). Montants en euros.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface NetEncours {
  /** Encours NET dû (= solde compte tiers, borné à [0, total factures]). */
  net: number;
  /** Encaissé / avoirs non affectés déduits du brut (ligne globale). */
  encaisse: number;
}

export function netEncours(openTotal: number, currentAccountBalance: number | null | undefined): NetEncours {
  const net =
    currentAccountBalance == null
      ? round2(openTotal)
      : round2(Math.max(0, Math.min(openTotal, currentAccountBalance)));
  return { net, encaisse: round2(openTotal - net) };
}
