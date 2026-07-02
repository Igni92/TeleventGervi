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
  cardCode: string;
  cardName: string;
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
  departed?: boolean;          // « départ » — partie en livraison
  departedBy?: string | null;  // qui a marqué le « départ »
  preparer?: string | null;    // préparateur affecté (qui a ouvert la commande)
  incomplete?: boolean;        // « à reprendre » — remise sur la file (pas finie)
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
  db?: string;
  date: string;
  holiday: string | null;
  count: number;
  totals: Totals;
  carriers: Carrier[];
  error?: string;
}

/* ─────────────────────────── États d'une commande ─────────────────────────── */

export type StatusTab = "A_PREPARER" | "FAIT" | "DEPART";

/** État courant d'une commande (mutuellement exclusif) : parti > préparé > à préparer. */
export function docStatus(d: { prepared: boolean; departed?: boolean }): StatusTab {
  if (d.departed) return "DEPART";
  if (d.prepared) return "FAIT";
  return "A_PREPARER";
}

/** Libellés courts des états — réutilisés par les actions groupées (transporteur). */
export const STATUS_LABEL: Record<StatusTab, string> = {
  A_PREPARER: "À préparer",
  FAIT: "Fait",
  DEPART: "Départ",
};

/** Comptes par état pour les onglets — les BL « avoir / exclu » ne comptent pas
 *  (ils restent visibles, grisés, mais ne représentent aucun travail réel). */
export function computeStatusCounts(carriers: Carrier[]): { aPreparer: number; fait: number; depart: number } {
  let aPreparer = 0, fait = 0, depart = 0;
  for (const car of carriers) for (const d of car.docs) {
    if (d.excluded) continue;
    const s = docStatus(d);
    if (s === "DEPART") depart++; else if (s === "FAIT") fait++; else aPreparer++;
  }
  return { aPreparer, fait, depart };
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
 * Recoupe les commandes par onglet (À préparer / Fait / Départ) et recalcule les
 * métriques (groupes + bandeau de synthèse). Même règle que le serveur : les BL
 * « avoir / exclu » restent dans les listes (affichés grisés) mais sont DÉDUITS
 * à 100 % des totaux, des métriques de groupe et du compte de commandes.
 */
export function computeView(data: Pick<ApiResp, "carriers">, tab: StatusTab): ViewSlice {
  const carriers = data.carriers
    .map((c) => {
      const docs = c.docs.filter((d) => docStatus(d) === tab);
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
