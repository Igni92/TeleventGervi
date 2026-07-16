/**
 * Construction des LOTS CANDIDATS proposés par article dans l'onglet « Bons de
 * commande » — logique PURE (sans I/O), testée par lib/lotCandidates.test.ts.
 *
 * Contexte métier : une commande en « bon de commande » part sans lot ; pour
 * chaque article, l'utilisateur choisit le n° d'entrée marchandise (EM) réellement
 * en stock. Le résolveur (lib/lotResolver) tient un HISTORIQUE de ~12 EM récentes
 * par article — mais les proposer toutes crée deux défauts vécus par l'opérateur :
 *
 *   1. TROP DE CHOIX : plusieurs EM du MÊME entrepôt (et même segment) alors qu'une
 *      seule — la plus récente — porte le stock réel (FIFO : les précédentes sont
 *      consommées).
 *   2. DES LOTS « PAS EN STOCK » : le stock SAP n'existe qu'à la maille article ×
 *      entrepôt (jamais par lot). L'ancien filtre acceptait une EM sans entrepôt
 *      connu dès que l'article avait DU stock N'IMPORTE OÙ → on proposait des lots
 *      invérifiables.
 *
 * Ce module réduit la liste au STRICT nécessaire : une EM par (entrepôt × segment),
 * la plus récente, uniquement si l'entrepôt de réception a du DISPO. Une EM sans
 * entrepôt vérifiable n'est retenue qu'en DERNIER RECOURS (aucun candidat vérifié
 * mais l'article a du dispo) — pour ne jamais laisser l'opérateur sans option,
 * sans pour autant le noyer de faux positifs.
 *
 * UNITÉ (16/07/2026) : les quantités injectées (`stockInWarehouse`,
 * `itemTotalStock`) sont le DISPONIBLE (= stock − réservé) exprimé EN COLIS —
 * plus le stock physique en unités SAP. Un entrepôt sous 1 COLIS de dispo est
 * traité comme épuisé : ses lots ne sont pas proposés (badge « en stock »
 * trompeur quand tout était déjà réservé).
 */

/** Affectation « stock commun » (défaut) — cf. lib/emAffect. */
const AFFECT_ALL = "TOUS";
/** Garde-fou : jamais plus de N lots proposés (après dédup, la liste est déjà courte). */
const DEFAULT_MAX = 6;
/** Dispo minimal (en colis) pour qu'un lot soit proposé — sous 1 colis : épuisé. */
const MIN_DISPO_COLIS = 1;

export interface LotCandidate {
  lot: string;
  docNum: number;
  warehouse: string | null;
  affect: string;
  date: string | null;
  supplier: string | null;
  label?: string;
  /** Dispo indicatif (stock − réservé, article × entrepôt de l'EM), EN COLIS — pas un stock PAR lot. */
  qty: number | null;
}

export interface CandidateInputs {
  itemCode: string;
  /** Entrepôt de la ligne de commande (priorité douce d'affichage ; souvent « 000 »
   *  pour une vente à découvert, donc jamais un filtre dur). */
  orderWarehouse: string | null;
  /** Segment du client servi (EXPORT / GMS / CHR) ou null. */
  segment: string | null;
  /** DocNums des EM récentes de l'article (plus récent d'abord), cf. lotResolver. */
  emDocs: number[];
  /** DocNum d'EM → entrepôt où l'article a été reçu dans cette EM (null si inconnu). */
  warehouseOf: (docNum: number) => string | null;
  /** DocNum d'EM → affectation segment (TOUS par défaut). */
  affectOf: (docNum: number) => string;
  /** DocNum d'EM → métadonnées d'affichage (date de réception, fournisseur, libellé). */
  metaOf: (docNum: number) => { date: string | null; supplier: string | null; label?: string };
  /** Dispo (stock − réservé) de l'article dans un entrepôt donné, EN COLIS (0 si aucun / inconnu). */
  stockInWarehouse: (warehouse: string | null) => number;
  /** Dispo total de l'article (tous entrepôts), EN COLIS. */
  itemTotalStock: number;
  /** Lot suggéré par resolveLotForSegment (« EM<DocNum> » ou null). */
  suggestedLot: string | null;
  /** Plafond de candidats (défaut 6). */
  max?: number;
}

/**
 * Réduit l'historique d'EM d'un article à une liste courte de lots RÉELLEMENT
 * proposables, triée par pertinence, avec la suggestion validée.
 */
export function buildLotCandidates(input: CandidateInputs): {
  candidates: LotCandidate[];
  suggested: string | null;
} {
  const { itemCode, orderWarehouse, emDocs } = input;
  const seg = (input.segment ?? "").trim().toUpperCase() || null;
  const max = input.max ?? DEFAULT_MAX;

  // 1. EM brutes → candidats avec métadonnées + dispo indicatif (colis) de leur entrepôt.
  const raw: LotCandidate[] = emDocs.map((dn) => {
    const warehouse = input.warehouseOf(dn);
    const meta = input.metaOf(dn);
    return {
      lot: `EM${dn}`,
      docNum: dn,
      warehouse,
      affect: (input.affectOf(dn) || AFFECT_ALL).trim().toUpperCase(),
      date: meta.date,
      supplier: meta.supplier,
      label: meta.label,
      qty: warehouse != null ? input.stockInWarehouse(warehouse) : input.itemTotalStock,
    };
  });

  // 2. Ne garde QUE les EM dont l'entrepôt de réception a AU MOINS 1 COLIS de
  //    dispo. Une EM sans entrepôt connu est invérifiable → écartée ici (repli en 4).
  const stocked = raw.filter((c) => c.warehouse != null && input.stockInWarehouse(c.warehouse) >= MIN_DISPO_COLIS);

  // 3. Dédup : une seule EM par (entrepôt × affectation) — la PLUS RÉCENTE. Les
  //    réceptions antérieures du même couple sont consommées (FIFO) : les lister
  //    est du bruit (« trop ») et trompeur (« pas en stock »).
  const byGroup = new Map<string, LotCandidate>();
  for (const c of stocked) {
    const key = `${c.warehouse}|${c.affect}`;
    const prev = byGroup.get(key);
    if (!prev || c.docNum > prev.docNum) byGroup.set(key, c);
  }
  let candidates = [...byGroup.values()];

  // 4. Repli : rien de vérifiable en stock MAIS l'article a ≥ 1 colis de dispo
  //    total → on propose la SEULE EM la plus récente (miroir stock parfois non
  //    ventilé par entrepôt), plutôt qu'une liste vide. Jamais plus d'un lot
  //    invérifiable.
  if (candidates.length === 0 && input.itemTotalStock >= MIN_DISPO_COLIS && raw.length > 0) {
    const mostRecent = raw.reduce((a, b) => (b.docNum > a.docNum ? b : a));
    candidates = [mostRecent];
  }

  // 5. Tri : entrepôt de la ligne d'abord, puis EM du segment du client, puis
  //    stock commun (Tous), puis autres segments ; à égalité, la plus récente.
  const rank = (c: LotCandidate): number => {
    let r = 0;
    if (orderWarehouse && c.warehouse === orderWarehouse) r -= 100;
    if (seg && c.affect === seg) r -= 20;
    else if (c.affect === AFFECT_ALL) r -= 10;
    return r;
  };
  candidates.sort((a, b) => rank(a) - rank(b) || b.docNum - a.docNum);

  // 6. Garde-fou (la dédup rend ce plafond rarement atteint).
  if (candidates.length > max) candidates = candidates.slice(0, max);

  // 7. Suggestion : conservée uniquement si elle a survécu au filtrage/dédup.
  const suggested = input.suggestedLot && candidates.some((c) => c.lot === input.suggestedLot)
    ? input.suggestedLot
    : null;

  return { candidates, suggested };
}
