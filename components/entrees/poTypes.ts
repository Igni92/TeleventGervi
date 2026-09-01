// Types partagés de l'espace Commandes fournisseurs (CF) — extraits pour être
// consommés à la fois par la liste (PurchaseOrderHistory) et l'éditeur unifié
// (PurchaseOrderEditor), sans dépendance circulaire.

export type PoLine = {
  itemCode: string; itemName?: string;
  pieceQuantity: number; packageQuantity: number | null;
  warehouse?: string;
  price: number | null; lineTotal: number | null; taxPercent: number | null;
  open: boolean;
  uPays: string | null; uMarque: string | null; uCondi: string | null; frgnName?: string | null;
};

export type PurchaseOrder = {
  docEntry: number; docNum: number; docDate: string; dueDate: string | null;
  cardCode: string; cardName?: string; numAtCard: string;
  open: boolean;
  cancelled: boolean;
  total: number; totalTTC: number; totalHT: number; totalTVA: number;
  comments: string; lineCount: number; lines: PoLine[];
  /** Entrées marchandise (PDN) créées depuis cette commande (réceptions). */
  ems?: { docEntry: number; docNum: number }[];
};

/** Agréage porté par la réception (cf. lib/agreage) : conforme, ou avec réserve. */
export type ReceiveAgreage = {
  status: "CONFORME" | "RESERVE";
  type?: string; note?: string;
  rating?: number | null;
  /** Note qualité PAR ARTICLE (agréage ligne par ligne). */
  lines?: { itemCode: string; rating: number }[];
};

export const PO_WAREHOUSES: { code: "000" | "01" | "R1"; label: string }[] = [
  { code: "000", label: "000 · A/C-A/D" },
  { code: "01", label: "01 · Stock" },
  { code: "R1", label: "R1 · J+1" },
];
