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
const TRCL_PROBE_TTL_MS = 6 * 60 * 60 * 1000; // re-sonde l'exposition TRCL toutes les 6 h
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
  U_DistBy?: string | null;     // tournée (« Distribué par »)
  U_TrspDef?: string | null;    // 'O' = transporteur par défaut
  U_DesTransp?: string | null;  // désignation libre du transporteur
}

// Chemins candidats : exposition UDT standard (U_<table>) puis service UDO
// (si un UDO nommé SERG_TRCL est enregistré un jour). Mémorise le 1ᵉʳ qui
// répond ; cache négatif 6 h pour ne pas payer 2 requêtes 400 à chaque client.
const TRCL_PATHS = ["U_SERG_TRCL", "SERG_TRCL"] as const;
let trclPath: string | null = null;       // chemin lisible détecté
let trclProbedAt = 0;                     // date de la dernière sonde

async function resolveTrclPath(): Promise<string | null> {
  if (trclPath) return trclPath;
  if (Date.now() - trclProbedAt < TRCL_PROBE_TTL_MS) return null; // sonde récente : toujours indisponible
  trclProbedAt = Date.now();
  for (const p of TRCL_PATHS) {
    try {
      await sap.get(`${p}?$top=1`, { env: "prod" });
      trclPath = p;
      console.log(`[clientCarriers] UDT SERG_TRCL exposée via '${p}' — bascule sur la vérité métier`);
      return p;
    } catch { /* Service Not Found → candidat suivant */ }
  }
  return null;
}

/** Lignes SERG_TRCL d'un client (null si l'UDT n'est pas lisible). */
async function fetchTrclRows(cardCode: string): Promise<TrclRow[] | null> {
  const path = await resolveTrclPath();
  if (!path) return null;
  try {
    return await sap.getAll<TrclRow>(
      `${path}?$filter=${encodeURIComponent(`U_CardCode eq '${odataQuote(cardCode)}'`)}`,
      { env: "prod", pageSize: 50, maxPages: 4 },
    );
  } catch (e) {
    // Exposition perdue entre-temps (changement SAP) → invalide et fallback.
    console.warn(`[clientCarriers] Lecture ${path} échouée, fallback histogramme:`, (e as Error).message);
    trclPath = null;
    return null;
  }
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

/**
 * Mappe un code U_TrspCode vers la table Carrier locale.
 * Si le code n'existe pas (ex. ECOLISE absent du seed initial) → création à la
 * volée : name = code capitalisé, position à la suite, kind="field".
 */
async function ensureCarrier(code: string): Promise<CarrierRow | null> {
  const existing = await prisma.carrier.findFirst({
    where: { sapValue: { equals: code, mode: "insensitive" } },
    select: { id: true, name: true, sapValue: true, position: true, active: true },
  });
  if (existing) return existing;

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
    return created;
  } catch (e) {
    // Course possible (nom unique déjà pris par un appel concurrent) → re-lecture.
    console.warn(`[clientCarriers] Création Carrier '${name}' en conflit, relecture:`, (e as Error).message);
    return prisma.carrier.findFirst({
      where: { OR: [{ sapValue: { equals: code, mode: "insensitive" } }, { name }] },
      select: { id: true, name: true, sapValue: true, position: true, active: true },
    });
  }
}

/* ───────────────────────────── Assemblages ──────────────────────────────── */

/** Construit la liste depuis les lignes SERG_TRCL du client. */
async function buildFromTrcl(rows: TrclRow[]): Promise<ClientCarriersResult | null> {
  // Une ligne = un couple (transporteur, tournée). Dédoublonne par TrspCode en
  // agrégeant les tournées ; la ligne U_TrspDef='O' (ou à défaut la 1ʳᵉ) est
  // la ligne principale → priorité 2 et tête de liste.
  const byCode = new Map<string, { tours: string[]; isDefault: boolean; order: number }>();
  rows.forEach((r, i) => {
    const code = (r.U_TrspCode ?? "").toString().trim().toUpperCase();
    if (!code) return;
    const tour = (r.U_DistBy ?? "").toString().trim();
    const cur = byCode.get(code) ?? { tours: [], isDefault: false, order: i };
    if (tour && !cur.tours.includes(tour)) cur.tours.push(tour);
    if ((r.U_TrspDef ?? "").toString().trim().toUpperCase() === "O") cur.isDefault = true;
    byCode.set(code, cur);
  });
  if (byCode.size === 0) return null; // client absent de l'UDT → fallback

  // Ligne principale en tête (défaut), puis ordre des lignes de l'UDT.
  const entries = [...byCode.entries()].sort((a, b) =>
    Number(b[1].isDefault) - Number(a[1].isDefault) || a[1].order - b[1].order,
  );
  // Si aucune ligne U_TrspDef='O', la 1ʳᵉ/unique ligne fait office de défaut.
  if (!entries.some(([, v]) => v.isDefault)) entries[0][1].isDefault = true;

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

/** Vide le cache — utile pour les tests / debug. */
export function _resetClientCarriersCache(): void {
  cache.clear();
  trclPath = null;
  trclProbedAt = 0;
}
