/**
 * Helpers de formatage partagés — remplacent les copies locales de `eur` /
 * `fmtColis` dupliquées dans GoodsReceiptHistory, PurchaseOrderHistory,
 * GoodsReceiptForm, PurchaseOrderForm…
 */

/** Montant € à 2 décimales (séparateur FR). */
export const eur = (n: number): string =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** Montant € entier (KPI/cumuls). */
export const eur0 = (n: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** Nb de colis : entier si rond, sinon 1 décimale (virgule FR). */
export const fmtColis = (n: number | null | undefined): string => {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};
