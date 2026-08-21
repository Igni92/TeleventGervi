"use client";

import { libelleUnite } from "@/lib/fabrication-optim";
import { eur, fmtColis } from "@/lib/format";

/**
 * Éléments visuels PROPRES à la fabrication. Les tags désignation
 * (marque/condi/origine) et les formats € / colis ne vivent plus ici : ils sont
 * mutualisés — `DesignationChips` (@/components/entrees/DesignationChips) pour
 * les chips, `lib/format` pour les montants. Ne restent ici que le badge de lot
 * (réel vs à découvert), la liste des magasins et les unités physiques réelles.
 */

/** Badge lot : EM<DocNum> (neutre) ou EM_PENDING (rose « à découvert »). */
export function LotBadge({ batchNumber, pending }: { batchNumber: string; pending: boolean }) {
  if (pending) {
    return (
      <span className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-caption2 font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-200 dark:ring-1 dark:ring-inset dark:ring-rose-400/50">
        À découvert · lot à réception
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center px-1.5 rounded text-caption2 font-mono font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-100 dark:ring-1 dark:ring-inset dark:ring-emerald-400/50">
      {batchNumber}
    </span>
  );
}

export const WAREHOUSES = [
  { code: "000", label: "000 · A/C-A/D" },
  { code: "01", label: "01 · Stock" },
  { code: "R1", label: "R1 · J+1" },
] as const;
export type WarehouseCode = (typeof WAREHOUSES)[number]["code"];

/** Montant € (mutualisé lib/format). */
export { eur };
/** Quantité colis : entier si rond, sinon 1 décimale (mutualisé lib/format). */
export const colis = (n: number) => fmtColis(n);
/** Quantité physique : entier si rond, sinon jusqu'à 3 décimales (virgule FR). */
export const qtePhys = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};
/** « 8 colis », « 36 kg », « 3 barquettes » — unité de gestion réelle accordée. */
export const qte = (n: number, unite: string) => `${qtePhys(n)} ${libelleUnite(unite, n)}`;
