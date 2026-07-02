/**
 * Logique de VUE du « Détail livraison » — fonctions pures, testables hors React.
 *
 * Types miroir de la réponse GET /api/livraisons + calculs partagés :
 *   • docStatus       : état courant d'une commande (parti > préparé > à préparer) ;
 *   • computeView     : re-filtrage par onglet + agrégats (groupes, bandeau) —
 *     les BL « avoir / exclu » restent LISTÉS (grisés) mais sont DÉDUITS à 100 %
 *     des totaux et des compteurs, comme côté serveur (app/api/livraisons/route.ts) ;
 *   • docTourneeKeyLabel : clé + libellé du sous-groupe tournée d'une commande.
 */

export interface Tournee {
  lineId: number;
  nom: string;
  des: string;
  heure: string | null;
}

export interface Line {
  itemCode: string;
  itemName: string;
  quantity: number;
  unit?: string | null;        // unité de vente (PIE, KG, COLIS…) — affichée sur le bon imprimé
  colis: number;
  weightKg: number;
  warehouse: string | null;
  marque?: string | null;
  condt?: string | null;
  pays?: string | null;
}

export interface Doc {
  docEntry: number;
  docNum: number;
  docDate: string;
  dueDate: string;
  takenAt?: string | null;     // heure de PRISE de la commande (création SAP)
  cardCode: string;
  cardName: string;
  cardFullName?: string;       // nom COMPLET (fiche client) pour les documents imprimés
  totalHT: number;
  totalTTC: number;
  colis: number;
  weightKg: number;
  open: boolean;
  comments: string;
  numAtCard: string;
  trspCode: string | null;
  trspHeure: string | null;
  savedTournee: { trspCode: string; heure: string | null; nom?: string | null; des?: string | null; lineId?: number | null } | null;
  carrierName: string | null;
  clientType: string | null;   // GMS | CHR | EXPORT | null
  prepared: boolean;           // « faite » — coché manuellement
  preparedBy?: string | null;  // qui a marqué la commande « faite »
  preparedAt?: string | null;  // heure (ISO) du clic « fait »
  departed?: boolean;          // « départ » — partie en livraison
  departedBy?: string | null;  // qui a marqué le « départ »
  departedAt?: string | null;  // heure (ISO) du clic « départ »
  preparer?: string | null;    // préparateur affecté (qui a ouvert la commande)
  incomplete?: boolean;        // « à reprendre » — remise sur la file (pas finie)
  missingItems?: string[];     // articles MANQUANTS (stock SAP total négatif)
  excluded: boolean;           // « avoir / exclu » — déduit 100 % des totaux
  lineCount: number;
  lines: Line[];
}

export interface Carrier {
  code: string | null;
  name: string;
  orders: number;
  colis: number;
  weightKg: number;
  totalHT: number;
  docs: Doc[];
}

export interface Totals {
  orders: number;
  clients: number;
  colis: number;
  weightKg: number;
  totalHT: number;
}

export interface ApiResp {
  ok: boolean;
  date: string;
  holiday: string | null;
  count: number;
  totals: Totals;
  carriers: Carrier[];
  /** Stock SAP total (négatif) par article manquant — pilote les achats. */
  negativeStocks?: Record<string, number>;
  error?: string;
}

/* ─────────────────────────── États d'une commande ─────────────────────────── */

export type StatusTab = "A_PREPARER" | "FAIT" | "DEPART";

/** Onglets de la vue : les 3 états d'avancement + « Manquants » (vue transverse
 *  des commandes du jour ayant au moins un article signalé manquant au picking). */
export type ViewTab = StatusTab | "MANQUANTS";

/** État courant d'une commande (mutuellement exclusif) : parti > préparé > à préparer. */
export function docStatus(d: { prepared: boolean; departed?: boolean }): StatusTab {
  if (d.departed) return "DEPART";
  if (d.prepared) return "FAIT";
  return "A_PREPARER";
}

/** Vrai si la commande a au moins un article signalé manquant (rupture picking). */
export function hasMissing(d: { missingItems?: string[] }): boolean {
  return (d.missingItems?.length ?? 0) > 0;
}

/** Libellés courts des états — réutilisés par les actions groupées (transporteur). */
export const STATUS_LABEL: Record<StatusTab, string> = {
  A_PREPARER: "À préparer",
  FAIT: "Fait",
  DEPART: "Départ",
};

/** Comptes par onglet — les BL « avoir / exclu » ne comptent pas dans les 3 états
 *  (ils restent visibles, grisés, mais ne représentent aucun travail réel).
 *  « Manquants » compte les COMMANDES ayant au moins un article signalé (tous
 *  états confondus, exclus compris — la rupture reste à traiter). */
export function computeStatusCounts(carriers: Carrier[]): { aPreparer: number; fait: number; depart: number; manquants: number } {
  let aPreparer = 0, fait = 0, depart = 0, manquants = 0;
  for (const car of carriers) for (const d of car.docs) {
    if (hasMissing(d)) manquants++;
    if (d.excluded) continue;
    const s = docStatus(d);
    if (s === "DEPART") depart++; else if (s === "FAIT") fait++; else aPreparer++;
  }
  return { aPreparer, fait, depart, manquants };
}

/* ─────────────────────── Filtre par segment client ────────────────────────── */

/** Filtres de segment client : « TOUT » (y compris les clients sans segment)
 *  ou un segment précis (CHR / EXPORT / GMS). */
export type SegmentTab = "TOUT" | "CHR" | "EXPORT" | "GMS";

export const SEGMENT_LABEL: Record<SegmentTab, string> = {
  TOUT: "Tout",
  CHR: "CHR",
  EXPORT: "Export",
  GMS: "GMS",
};

/** Recoupe les groupes transporteur par segment client. « TOUT » = aucune
 *  restriction (les clients sans segment restent visibles). Les métriques des
 *  groupes ne sont PAS recalculées ici — computeView s'en charge en aval. */
export function filterBySegment(carriers: Carrier[], seg: SegmentTab): Carrier[] {
  if (seg === "TOUT") return carriers;
  return carriers
    .map((c) => ({ ...c, docs: c.docs.filter((d) => d.clientType === seg) }))
    .filter((c) => c.docs.length > 0);
}

/** Comptes par segment — même règle que computeStatusCounts : les BL
 *  « avoir / exclu » ne comptent pas. « TOUT » inclut les clients sans segment. */
export function computeSegmentCounts(carriers: Carrier[]): Record<SegmentTab, number> {
  const counts: Record<SegmentTab, number> = { TOUT: 0, CHR: 0, EXPORT: 0, GMS: 0 };
  for (const car of carriers) for (const d of car.docs) {
    if (d.excluded) continue;
    counts.TOUT++;
    const t = d.clientType;
    if (t === "CHR" || t === "EXPORT" || t === "GMS") counts[t]++;
  }
  return counts;
}

/* ───────────────────────── Vue filtrée par onglet ─────────────────────────── */

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ViewSlice {
  carriers: Carrier[];
  totals: Totals;
  count: number;
}

/**
 * Recoupe les commandes par onglet (À préparer / Fait / Départ, ou « Manquants »
 * — tous états confondus) et recalcule les métriques (groupes + bandeau de
 * synthèse). Même règle que le serveur : les BL « avoir / exclu » restent dans
 * les listes (affichés grisés) mais sont DÉDUITS à 100 % des totaux, des
 * métriques de groupe et du compte de commandes.
 */
export function computeView(data: Pick<ApiResp, "carriers">, tab: ViewTab): ViewSlice {
  const carriers = data.carriers
    .map((c) => {
      const docs = c.docs.filter((d) => (tab === "MANQUANTS" ? hasMissing(d) : docStatus(d) === tab));
      const counted = docs.filter((d) => !d.excluded);
      return {
        ...c, docs,
        orders: counted.length,
        colis: r1(counted.reduce((s, d) => s + d.colis, 0)),
        weightKg: r1(counted.reduce((s, d) => s + d.weightKg, 0)),
        totalHT: r2(counted.reduce((s, d) => s + d.totalHT, 0)),
      };
    })
    .filter((c) => c.docs.length > 0);
  const allDocs = carriers.flatMap((c) => c.docs);
  const counted = allDocs.filter((d) => !d.excluded);
  const totals: Totals = {
    orders: counted.length,
    clients: new Set(counted.map((d) => d.cardCode)).size,
    colis: r1(counted.reduce((s, d) => s + d.colis, 0)),
    weightKg: r1(counted.reduce((s, d) => s + d.weightKg, 0)),
    totalHT: r2(counted.reduce((s, d) => s + d.totalHT, 0)),
  };
  return { carriers, totals, count: allDocs.length };
}

/* ──────────────────────── Sous-groupes par tournée ────────────────────────── */

/** Clé + libellé de la TOURNÉE d'une commande (sous-groupe sous le transporteur).
 *  On veut le NOM de la tournée (IDF, IDF 2, NORD…), pas l'heure :
 *   1) nom mémorisé (SERG_TRCL U_DistBy) s'il est connu ;
 *   2) sinon on le résout dans le catalogue du transporteur (`tournees`) — comme
 *      le sélecteur de ligne — par LineId mémorisé, puis par heure du BL ;
 *   3) repli ultime sur l'heure, puis « Sans tournée ». */
export function docTourneeKeyLabel(d: Doc, tournees?: Tournee[]): { key: string; label: string } {
  const savedNom = (d.savedTournee?.nom ?? "").trim();
  if (savedNom) return { key: `T:${savedNom.toUpperCase()}`, label: savedNom };

  if (tournees && tournees.length) {
    const saved = d.savedTournee;
    let t: Tournee | undefined;
    if (saved?.lineId != null) t = tournees.find((x) => x.lineId === saved.lineId);
    if (!t && d.trspHeure) t = tournees.find((x) => x.heure === d.trspHeure);
    const nom = (t?.nom ?? "").trim();
    if (nom) return { key: `T:${nom.toUpperCase()}`, label: nom };
  }

  const h = (d.trspHeure ?? "").slice(0, 5);
  if (h) return { key: `H:${h}`, label: `Tournée ${h}` };
  return { key: "T:__none__", label: "Sans tournée" };
}
