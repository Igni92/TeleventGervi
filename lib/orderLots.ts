/**
 * ÉTAT DES LOTS D'UNE COMMANDE (BL SAP) — détection des lignes SANS lot réel.
 *
 * Garantie métier (demande explicite) : **aucune commande ne doit partir en
 * livraison sans un vrai numéro de lot sur chaque ligne**. Une ligne « en
 * attente » (vide, EM_PENDING à découvert, ou sentinel famille EM_FAM:<fruit>)
 * n'est PAS traçable — elle bloque le départ (cf. /api/livraisons/departed).
 *
 * La partie PURE (`pendingLotItems`) est testée par lib/orderLots.test.ts ;
 * `getOrderLotStatus` lit le BL dans SAP (Service Layer).
 */
import { sap } from "./sapb1";
import { isLotPending, familyOfLot, isRealLot } from "./gervifrais-calc";

/** Ligne brute d'un document SAP (Order/Quotation) telle que renvoyée par le SL. */
export interface RawLotLine {
  itemCode?: string;
  itemName?: string | null;
  quantity?: number;
  U_NoLot?: string | null;
}

/** Article d'une commande dont au moins une ligne attend encore un lot. */
export interface PendingLotItem {
  itemCode: string;
  itemName: string | null;
  /** Quantité (SAP) encore SANS lot réel sur cet article. */
  pendingQty: number;
  /** Lot courant de la ligne en attente : "" (vide), "EM_PENDING" ou "EM_FAM:<fruit>". */
  lot: string;
  /** Clé de famille si la ligne porte un sentinel produit (EM_FAM:<fruit>), sinon null. */
  familyKey: string | null;
}

/**
 * PUR — à partir des lignes d'un document, renvoie les ARTICLES dont au moins une
 * ligne n'a pas de vrai lot `EM<DocNum>`. Fusion par article ; on cumule la
 * quantité des seules lignes en attente. Liste vide ⇒ toutes les lignes sont
 * tracées (départ autorisé).
 */
export function pendingLotItems(lines: RawLotLine[]): PendingLotItem[] {
  const byItem = new Map<string, PendingLotItem>();
  for (const l of lines) {
    const code = (l.itemCode ?? "").trim();
    if (!code) continue;
    if (!isLotPending(l.U_NoLot)) continue; // ligne déjà tracée → ignorée
    const rawLot = (l.U_NoLot ?? "").trim();
    const famKey = familyOfLot(rawLot);
    const cur = byItem.get(code);
    if (cur) {
      cur.pendingQty += l.quantity ?? 0;
      if (!cur.familyKey && famKey) { cur.familyKey = famKey; cur.lot = rawLot; }
    } else {
      byItem.set(code, {
        itemCode: code,
        itemName: (l.itemName ?? "").trim() || null,
        pendingQty: l.quantity ?? 0,
        lot: rawLot || "EM_PENDING",
        familyKey: famKey,
      });
    }
  }
  return [...byItem.values()];
}

/** Une ligne d'un BL portant un VRAI lot EM<DocNum> (pour un contrôle DLC en aval). */
export interface RealLotLine {
  itemCode: string;
  itemName: string | null;
  lot: string;
  quantity: number;
}

/** PUR — lignes portant un vrai lot EM<DocNum> (fusion par article×lot). */
export function realLotLines(lines: RawLotLine[]): RealLotLine[] {
  const byKey = new Map<string, RealLotLine>();
  for (const l of lines) {
    const code = (l.itemCode ?? "").trim();
    const lot = (l.U_NoLot ?? "").trim();
    if (!code || !isRealLot(lot)) continue;
    const key = `${code}|${lot}`;
    const cur = byKey.get(key);
    if (cur) cur.quantity += l.quantity ?? 0;
    else byKey.set(key, { itemCode: code, itemName: (l.itemName ?? "").trim() || null, lot, quantity: l.quantity ?? 0 });
  }
  return [...byKey.values()];
}

export interface OrderLotStatus {
  docEntry: number;
  docNum: number | null;
  /** Articles encore sans lot réel (vide ⇒ commande entièrement tracée). */
  pending: PendingLotItem[];
  /** Lignes à vrai lot EM<DocNum> — pour un contrôle DLC (péremption) en aval. */
  resolved: RealLotLine[];
  allResolved: boolean;
  /** true si l'on n'a PAS pu lire le BL dans SAP (on ne bloque alors pas à tort). */
  unverified: boolean;
}

type SapOrderDoc = {
  DocEntry: number; DocNum?: number;
  DocumentLines?: { ItemCode?: string; ItemDescription?: string; Quantity?: number; U_NoLot?: string | null }[];
};

/**
 * Lit un BL (Order) dans SAP et classe ses lignes. En cas d'échec SAP, renvoie
 * `unverified:true` avec des listes vides — l'appelant décide (par défaut : ne pas
 * bloquer l'entrepôt sur une panne SAP, mais signaler).
 */
export async function getOrderLotStatus(docEntry: number): Promise<OrderLotStatus> {
  try {
    const doc = await sap.get<SapOrderDoc>(`Orders(${docEntry})?$select=DocEntry,DocNum,DocumentLines`);
    const raw: RawLotLine[] = (doc.DocumentLines ?? []).map((l) => ({
      itemCode: l.ItemCode, itemName: l.ItemDescription ?? null,
      quantity: l.Quantity, U_NoLot: l.U_NoLot,
    }));
    const pending = pendingLotItems(raw);
    return {
      docEntry, docNum: doc.DocNum ?? null,
      pending, resolved: realLotLines(raw),
      allResolved: pending.length === 0, unverified: false,
    };
  } catch {
    return { docEntry, docNum: null, pending: [], resolved: [], allResolved: false, unverified: true };
  }
}
