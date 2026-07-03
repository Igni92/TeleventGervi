/**
 * Transporteurs / tournées possibles PAR CLIENT.
 *
 * ── Source de vérité MÉTIER : l'UDT SAP `SERG_TRCL` (« Données transporteurs
 *    clients ») — une ligne par (client × transporteur × tournée) :
 *      U_CardCode  → client
 *      U_TrspCode  → transporteur à proposer
 *      U_DistBy    → tournée de livraison (« Distribué par »)
 *      U_TrspDef   → 'O' = ligne principale (transporteur par défaut)
 *      U_Lundi..U_Dimanche ('O'/'N'), U_Heure, U_DesTransp, U_Rmqs…
 *
 * ── ⚠️ ÉTAT DE L'EXPOSITION (enquête scripts/diag-trcl.mjs, 12/06/2026) :
 *    la table EXISTE (UserTablesMD OK, type bott_MasterData) mais n'est PAS
 *    lisible via le Service Layer de cette base :
 *      - GET SERG_TRCL / U_SERG_TRCL → 400 « Service Not Found » (v1 ET v2) ;
 *      - aucune occurrence dans $metadata (entité non exposée — les tables
 *        bott_MasterData ne sont exposées que via un UDO, et AUCUN UDO n'est
 *        enregistré sur SERG_TRCL d'après UserObjectsMD) ;
 *      - SQLQueries → 702 « Table '@SERG_TRCL' not accessible » (le service ne
 *        peut requêter que les tables exposées) et de toute façon 403
 *        « User-Defined Object Registration » (droit manquant pour CRÉER une
 *        SQLQuery avec cet utilisateur SL).
 *    → Déblocage côté SAP : enregistrer un UDO sur SERG_TRCL (l'entité devient
 *      alors lisible) ou donner le droit UDO Registration à l'utilisateur SL.
 *
 * ── Architecture TRCL-first : ce module SONDE l'exposition au runtime (cache
 *    négatif 6 h). Dès que l'UDT devient lisible (U_SERG_TRCL ou service UDO
 *    SERG_TRCL), il bascule automatiquement dessus. En attendant, FALLBACK sur
 *    l'histogramme historique ORDR.U_TrspCode 24 mois (l'ancienne logique),
 *    signalé par `source: "history"` dans la réponse.
 *
 * Consommé par :
 *   - GET /api/clients/[id]/carriers (B3 — liste pour le front)
 *   - POST /api/sap/orders (B2 — transporteur par défaut si carrierId absent)
 */
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

export type ClientCarrierStat = {
  id: string;          // Carrier.id (table locale)
  name: string;        // Carrier.name (libellé app)
  sapValue: string;    // code U_TrspCode SAP (ex. "ECOLISE")
  // Indicateur de priorité (contrat historique conservé) :
  //  - source "trcl"    → 2 = ligne principale (U_TrspDef='O'), 1 = autre ligne
  //  - source "history" → occurrences dans l'historique 24 mois
  count: number;
  // Tournée de livraison (SERG_TRCL.U_DistBy) — additif, absent en fallback.
  tour?: string | null;
  // Heure de tournée (SERG_TRCL.U_Heure) convertie en "HH:MM:SS" → ORDR.U_TrspHeur.
  heure?: string | null;
};

export type ClientCarriersResult = {
  carriers: ClientCarrierStat[];   // triés par priorité desc (défaut en tête)
  defaultId: string | null;        // ligne principale TRCL, sinon le plus utilisé
  // Provenance des données : "trcl" = UDT SERG_TRCL (vérité métier),
  // "history" = histogramme Orders 24 mois (fallback tant que l'UDT n'est pas
  // exposée par le Service Layer — cf. en-tête du fichier).
  source: "trcl" | "history";
};

const TTL_MS = 10 * 60 * 1000;             // cache résultat par client
const HISTORY_MONTHS = 24;

// Cache module-level par CardCode — évite de marteler SAP pendant la prise de
// commande (la liste est demandée à chaque ouverture du sélecteur).
const cache = new Map<string, { at: number; result: ClientCarriersResult }>();

/** "ECOLISE" → "Ecolise" (nom par défaut d'un Carrier créé à la volée). */
function prettyName(code: string): string {
  const c = code.trim();
  if (!c) return c;
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

/** Échappe les apostrophes pour un littéral OData. */
function odataQuote(v: string): string {
  return v.replace(/'/g, "''");
}

/* ───────────────────────── SERG_TRCL (vérité métier) ───────────────────── */

/** Ligne de l'UDT telle qu'exposée par le Service Layer (préfixe U_). */
interface TrclRow {
  Code?: string;
  U_CardCode?: string | null;
  U_TrspCode?: string | null;
  U_DistBy?: string | null;     // tournée (« Distribué par »), ex. "NORD"
  U_Heure?: string | null;      // heure de tournée, format "10H30"
  U_TrspDef?: string | null;    // 'O' = transporteur par défaut
  U_DesTransp?: string | null;  // désignation libre du transporteur
}

// SERG_TRCL est exposée en VUE Service Layer **v2** (view.svc) :
// GET /b1s/v2/view.svc/GERVI_SERG_TRCLB1SLQuery. On lit les lignes d'un client
// via sap.getV2View (filtre U_CardCode). En cas d'échec → fallback histogramme.
const TRCL_VIEW = "GERVI_SERG_TRCLB1SLQuery";

/** "10H30" / "5H00" → "10:30:00" / "05:00:00" (format U_TrspHeur du BL). */
export function heureVueToBL(v: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})\s*[Hh:]\s*(\d{0,2})\s*$/.exec((v ?? "").toString());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${(m[2] || "0").padStart(2, "0")}:00`;
}

/**
 * Drapeau « transporteur par défaut » d'une ligne TRCL — lecture TOLÉRANTE.
 *
 * Dans l'UDT SAP la colonne est `U_TrspDef` ('O' = défaut, 'N' sinon), mais la
 * vue SL (B1SLQuery) peut la renvoyer avec une autre casse (U_TRSPDEF…), un
 * alias (TrspDef, U_Defaut…) ou une valeur 'Y'. Ne reconnaître QUE
 * `U_TrspDef === 'O'` faisait retomber silencieusement le défaut sur la 1ʳᵉ
 * ligne de la vue — d'où des BL créés avec le MAUVAIS transporteur alors que
 * SAP affiche bien le 'O'.
 */
function rowIsDefault(r: TrclRow): boolean {
  const rec = r as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    const kl = k.toLowerCase();
    if (kl === "u_trspdef" || kl === "trspdef" || kl === "u_defaut" || kl === "defaut" || kl === "u_def") {
      const v = String(rec[k] ?? "").trim().toUpperCase();
      return v === "O" || v === "Y" || v === "OUI" || v === "1" || v === "TRUE";
    }
  }
  return false;
}

/** Vrai si la ligne porte AU MOINS une colonne « défaut » (peu importe la valeur). */
function rowHasDefaultColumn(r: TrclRow): boolean {
  return Object.keys(r as Record<string, unknown>).some((k) => {
    const kl = k.toLowerCase();
    return kl === "u_trspdef" || kl === "trspdef" || kl === "u_defaut" || kl === "defaut" || kl === "u_def";
  });
}

// Cache des lignes brutes de la vue par client (évite de re-lire la vue pour la
// prise de commande ET l'écran livraison — même TTL que le résultat).
const trclRowsCache = new Map<string, { at: number; rows: TrclRow[] }>();

/** Lignes SERG_TRCL d'un client via la vue v2 (null si la lecture échoue).
 *  Repli : si le filtre exact ne renvoie RIEN (casse/espaces du CardCode côté
 *  vue), on retente via la vue COMPLÈTE en cache, indexée insensible à la casse. */
async function fetchTrclRows(cardCode: string): Promise<TrclRow[] | null> {
  const key = cardCode.trim().toUpperCase();
  const hit = trclRowsCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  try {
    const rows = await sap.getV2View<TrclRow>(TRCL_VIEW, {
      filter: `U_CardCode eq '${odataQuote(cardCode)}'`,
      top: 100,
      env: "prod",
    });
    if (rows.length > 0) {
      trclRowsCache.set(key, { at: Date.now(), rows });
      return rows;
    }
    // 0 ligne sur le filtre exact → la vue stocke peut-être le CardCode avec une
    // autre casse / des espaces : la vue complète (indexée .trim().toUpperCase())
    // reste la source la plus fiable.
    const byCard = await getAllTrclRowsByCard();
    const fromAll = byCard?.get(key) ?? null;
    if (fromAll && fromAll.length > 0) {
      trclRowsCache.set(key, { at: Date.now(), rows: fromAll });
      return fromAll;
    }
    trclRowsCache.set(key, { at: Date.now(), rows: [] });
    return [];
  } catch (e) {
    console.warn(`[clientCarriers] Lecture vue ${TRCL_VIEW} échouée (${cardCode}), fallback histogramme:`, (e as Error).message);
    return null;
  }
}

// ── Vue SERG_TRCL COMPLÈTE en cache (perf) ──────────────────────────────────
// /api/livraisons a besoin de la tournée de TOUS les clients du jour. Plutôt que
// N requêtes filtrées (lentes), on charge la vue entière UNE fois (lignes
// affectées seulement), on indexe par client et on met en cache (coalescé).
const ALL_TTL_MS = 30 * 60 * 1000;
let allTrclCache: { at: number; byCard: Map<string, TrclRow[]> } | null = null;
let allTrclInflight: Promise<Map<string, TrclRow[]> | null> | null = null;

async function getAllTrclRowsByCard(): Promise<Map<string, TrclRow[]> | null> {
  if (allTrclCache && Date.now() - allTrclCache.at < ALL_TTL_MS) return allTrclCache.byCard;
  if (allTrclInflight) return allTrclInflight;
  allTrclInflight = (async () => {
    try {
      const rows = await sap.getV2ViewAll<TrclRow>(TRCL_VIEW, {
        filter: "U_TrspCode ne ''",  // uniquement les lignes RÉELLEMENT affectées
        pageSize: 500, maxPages: 40, env: "prod",
      });
      const byCard = new Map<string, TrclRow[]>();
      for (const r of rows) {
        const cc = (r.U_CardCode ?? "").toString().trim().toUpperCase();
        if (!cc) continue;
        let arr = byCard.get(cc);
        if (!arr) { arr = []; byCard.set(cc, arr); }
        arr.push(r);
      }
      allTrclCache = { at: Date.now(), byCard };
      return byCard;
    } catch (e) {
      console.warn(`[clientCarriers] Chargement complet vue ${TRCL_VIEW} échoué:`, (e as Error).message);
      return null;
    } finally {
      allTrclInflight = null;
    }
  })();
  return allTrclInflight;
}

/**
 * Transporteurs/tournées d'un client depuis SERG_TRCL UNIQUEMENT (vue v2), SANS
 * fallback histogramme. Lit la vue COMPLÈTE en cache (1 requête pour toute la
 * journée). null si la vue est illisible ou le client absent.
 */
export async function getClientTrclCarriers(cardCode: string): Promise<ClientCarrierStat[] | null> {
  const byCard = await getAllTrclRowsByCard();
  if (!byCard) return null;
  const rows = byCard.get(cardCode.trim().toUpperCase());
  if (!rows || rows.length === 0) return null;
  const res = await buildFromTrcl(rows);
  return res ? res.carriers : null;
}

/* ─────────────────── Fallback : histogramme Orders 24 mois ──────────────── */

/**
 * Histogramme U_TrspCode des Orders SAP du client sur 24 mois.
 * Lecture PROD (référentiel historique) — les écritures restent sur l'env actif.
 */
async function fetchTrspHistogram(cardCode: string): Promise<Map<string, number>> {
  const since = new Date();
  since.setMonth(since.getMonth() - HISTORY_MONTHS);
  const sinceStr = since.toISOString().slice(0, 10);

  // ⚠️ Date QUOTÉE (particularité de cette base) + pagination gérée par getAll
  // (header Prefer inclus — sans lui le SL plafonne à 20 docs/page).
  const rows = await sap.getAll<{ DocEntry: number; U_TrspCode?: string | null }>(
    `Orders?$select=DocEntry,U_TrspCode&$filter=${encodeURIComponent(
      `CardCode eq '${odataQuote(cardCode)}' and DocDate ge '${sinceStr}'`,
    )}`,
    { env: "prod", pageSize: 200, maxPages: 30 },
  );

  const counts = new Map<string, number>();
  for (const r of rows) {
    const code = (r.U_TrspCode ?? "").toString().trim().toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

type CarrierRow = { id: string; name: string; sapValue: string | null; position: number; active: boolean };

// Cache module par CODE (TTL) : /api/livraisons résout la tournée de tous les
// clients du jour, et de nombreux clients partagent le même transporteur —
// sans cache, ensureCarrier refaisait un findFirst par (client × code).
const carrierRowCache = new Map<string, { at: number; row: CarrierRow | null }>();

/**
 * Mappe un code U_TrspCode vers la table Carrier locale.
 * Si le code n'existe pas (ex. ECOLISE absent du seed initial) → création à la
 * volée : name = code capitalisé, position à la suite, kind="field".
 */
async function ensureCarrier(code: string): Promise<CarrierRow | null> {
  const cacheKey = code.trim().toUpperCase();
  const cached = carrierRowCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS && cached.row) return cached.row;

  const existing = await prisma.carrier.findFirst({
    where: { sapValue: { equals: code, mode: "insensitive" } },
    select: { id: true, name: true, sapValue: true, position: true, active: true },
  });
  if (existing) {
    carrierRowCache.set(cacheKey, { at: Date.now(), row: existing });
    return existing;
  }

  const max = await prisma.carrier.aggregate({ _max: { position: true } });
  const name = prettyName(code);
  try {
    const created = await prisma.carrier.create({
      data: {
        name,
        kind: "field",
        sapField: "U_TrspCode",
        sapValue: code,
        active: true,
        position: (max._max.position ?? 0) + 1,
      },
      select: { id: true, name: true, sapValue: true, position: true, active: true },
    });
    console.log(`[clientCarriers] Carrier créé à la volée: ${name} (U_TrspCode=${code})`);
    carrierRowCache.set(cacheKey, { at: Date.now(), row: created });
    return created;
  } catch (e) {
    // Course possible (nom unique déjà pris par un appel concurrent) → re-lecture.
    console.warn(`[clientCarriers] Création Carrier '${name}' en conflit, relecture:`, (e as Error).message);
    const relu = await prisma.carrier.findFirst({
      where: { OR: [{ sapValue: { equals: code, mode: "insensitive" } }, { name }] },
      select: { id: true, name: true, sapValue: true, position: true, active: true },
    });
    if (relu) carrierRowCache.set(cacheKey, { at: Date.now(), row: relu });
    return relu;
  }
}

/* ───────────────────────────── Assemblages ──────────────────────────────── */

/** Construit la liste depuis les lignes SERG_TRCL du client. */
async function buildFromTrcl(rows: TrclRow[]): Promise<ClientCarriersResult | null> {
  // Une ligne = un couple (transporteur, tournée). Dédoublonne par TrspCode en
  // agrégeant les tournées ; la ligne U_TrspDef='O' (lecture tolérante, cf.
  // rowIsDefault — ou à défaut la 1ʳᵉ) est la ligne principale → priorité 2 et
  // tête de liste. La tournée/heure de la ligne 'O' PRIME sur celles des autres
  // lignes du même transporteur (c'est elle que l'utilisateur a désignée).
  const byCode = new Map<string, { tours: string[]; isDefault: boolean; order: number; heure: string | null; defHeure: string | null; defTour: string | null }>();
  rows.forEach((r, i) => {
    const code = (r.U_TrspCode ?? "").toString().trim().toUpperCase();
    if (!code) return; // lignes « vides » de la vue (slots non affectés) ignorées
    const tour = (r.U_DistBy ?? "").toString().trim();
    const cur = byCode.get(code) ?? { tours: [], isDefault: false, order: i, heure: null, defHeure: null, defTour: null };
    if (tour && !cur.tours.includes(tour)) cur.tours.push(tour);
    if (!cur.heure) cur.heure = heureVueToBL(r.U_Heure);  // 1re heure non vide
    if (rowIsDefault(r)) {
      cur.isDefault = true;
      if (!cur.defHeure) cur.defHeure = heureVueToBL(r.U_Heure);
      if (!cur.defTour && tour) cur.defTour = tour;
    }
    byCode.set(code, cur);
  });
  if (byCode.size === 0) return null; // client absent de l'UDT → fallback

  // Ligne 'O' → son heure/sa tournée deviennent la référence du transporteur.
  for (const v of byCode.values()) {
    if (v.defHeure) v.heure = v.defHeure;
    if (v.defTour) v.tours = [v.defTour, ...v.tours.filter((t) => t !== v.defTour)];
  }

  // Ligne principale en tête (défaut), puis ordre des lignes de l'UDT.
  const entries = Array.from(byCode.entries()).sort((a, b) =>
    Number(b[1].isDefault) - Number(a[1].isDefault) || a[1].order - b[1].order,
  );
  // Si aucune ligne U_TrspDef='O', la 1ʳᵉ/unique ligne fait office de défaut.
  // Si la VUE n'expose aucune colonne « défaut », on le signale : le défaut
  // affiché ne reflète alors PAS le 'O' de SAP → étendre la vue B1SLQuery
  // (GERVI_SERG_TRCL) pour inclure U_TrspDef.
  if (!entries.some(([, v]) => v.isDefault)) {
    if (rows.length > 0 && !rows.some(rowHasDefaultColumn)) {
      console.warn(
        `[clientCarriers] La vue ${TRCL_VIEW} n'expose pas la colonne U_TrspDef — ` +
        `le transporteur par défaut (colonne 'O' dans SAP) ne peut pas être respecté ; ` +
        `repli sur la 1ʳᵉ ligne. Ajoutez U_TrspDef au SELECT de la vue SAP.`,
      );
    }
    entries[0][1].isDefault = true;
  }

  const carriers: ClientCarrierStat[] = [];
  for (const [code, info] of entries) {
    const row = await ensureCarrier(code);
    if (!row) {
      console.warn(`[clientCarriers] Code TRCL '${code}' non mappable vers Carrier — ignoré`);
      continue;
    }
    carriers.push({
      id: row.id,
      name: row.name,
      sapValue: code,
      count: info.isDefault ? 2 : 1, // indicateur de priorité (contrat conservé)
      tour: info.tours.length ? info.tours.join(" / ") : null,
      heure: info.heure,
    });
  }
  if (carriers.length === 0) return null;
  return { carriers, defaultId: carriers[0].id, source: "trcl" };
}

/** Construit la liste depuis l'histogramme Orders (fallback). */
async function buildFromHistory(cardCode: string): Promise<ClientCarriersResult> {
  const counts = await fetchTrspHistogram(cardCode);

  const carriers: ClientCarrierStat[] = [];
  // Tri par occurrences desc AVANT mapping (l'ordre détermine defaultId).
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sorted) {
    const row = await ensureCarrier(code);
    if (!row) {
      console.warn(`[clientCarriers] Code U_TrspCode '${code}' non mappable vers Carrier — ignoré`);
      continue;
    }
    carriers.push({ id: row.id, name: row.name, sapValue: code, count });
  }
  return { carriers, defaultId: carriers[0]?.id ?? null, source: "history" };
}

/**
 * Transporteurs possibles d'un client (CardCode SAP) + défaut.
 * Contrat front (NE PAS dévier) :
 *   { carriers: [{ id, name, sapValue, count }], defaultId: string | null }
 * (+ champs additifs `tour` par carrier et `source` global — ignorés par les
 *  consommateurs existants). Sans donnée → carriers: [] + defaultId: null.
 *
 * Priorité des sources : SERG_TRCL (tournées clients, vérité métier) puis
 * histogramme Orders 24 mois tant que l'UDT n'est pas exposée (cf. en-tête).
 */
export async function getClientCarriers(cardCode: string): Promise<ClientCarriersResult> {
  const key = cardCode.trim().toUpperCase();
  if (!key) return { carriers: [], defaultId: null, source: "history" };

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;

  let result: ClientCarriersResult | null = null;

  const trclRows = await fetchTrclRows(cardCode.trim());
  if (trclRows) result = await buildFromTrcl(trclRows);
  if (!result) result = await buildFromHistory(cardCode.trim());

  cache.set(key, { at: Date.now(), result });
  return result;
}

/**
 * Transporteur PAR DÉFAUT d'un client (B2) = ligne principale SERG_TRCL
 * (U_TrspDef='O' / 1ʳᵉ ligne), sinon le plus utilisé sur 24 mois.
 * Renvoie null si aucune donnée (l'appelant ne pose alors rien et le log).
 */
export async function getDefaultCarrier(cardCode: string): Promise<ClientCarrierStat | null> {
  const { carriers } = await getClientCarriers(cardCode);
  return carriers[0] ?? null;
}

/**
 * Transporteur par défaut STRICT = ligne principale SERG_TRCL (U_TrspDef='O').
 * Contrairement à getDefaultCarrier, ne retombe PAS sur « le plus utilisé » :
 * si la vérité métier (SERG_TRCL) n'est pas disponible, renvoie null (l'appelant
 * ne pose alors aucun transporteur → on laisse le défaut SAP, choix dans
 * « Détail livraison »). Demande métier : ne jamais imposer le plus utilisé.
 */
export async function getTrclDefaultCarrier(cardCode: string): Promise<ClientCarrierStat | null> {
  const res = await getClientCarriers(cardCode);
  if (res.source !== "trcl") return null;
  return res.carriers.find((c) => c.id === res.defaultId) ?? res.carriers[0] ?? null;
}

/**
 * Heure de tournée (U_TrspHeur, "HH:MM:SS") d'un transporteur PRÉCIS pour un
 * client, telle que définie dans SERG_TRCL.
 *
 * Sert à COMPLÉTER U_TrspHeur à la création d'un bon quand le transporteur est
 * choisi via l'UI (carrierId / carrierCode) : ce chemin ne transmet QUE le code
 * transporteur, pas l'heure. Sans elle, la commande partait avec le bon
 * transporteur mais SANS sa tournée → non rattachée dans le récap transporteur SAP.
 *
 * Renvoie null si la source n'est pas SERG_TRCL (fallback histogramme = pas
 * d'heure), si le transporteur est absent du client, ou s'il n'a pas d'heure.
 */
export async function getTrclCarrierHeure(cardCode: string, trspCode: string): Promise<string | null> {
  const code = (trspCode ?? "").trim().toUpperCase();
  if (!code) return null;
  const res = await getClientCarriers(cardCode);
  if (res.source !== "trcl") return null;
  const hit = res.carriers.find((c) => c.sapValue.trim().toUpperCase() === code);
  return hit?.heure ?? null;
}

/** Vide le cache — utile pour les tests / debug. */
export function _resetClientCarriersCache(): void {
  cache.clear();
  trclRowsCache.clear();
  carrierRowCache.clear();
  allTrclCache = null;
}
