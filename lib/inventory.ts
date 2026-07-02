import { prisma } from "@/lib/prisma";

/**
 * Inventaire (comptage du préparateur) — stocké dans la table clé/valeur
 * AppSetting (clé `inv:<id>`, valeur = JSON), pour éviter toute migration.
 *
 * Cycle : un préparateur saisit le stock RÉEL en face du stock SAP → une
 * session « submitted » est créée avec les écarts ; les administrateurs la
 * voient (badge + écarts) et la marquent « reviewed ».
 */

const PREFIX = "inv:";

export interface InventoryLine {
  itemCode: string;
  itemName: string;
  sapQty: number;        // stock SAP au moment de la saisie
  realQty: number;       // stock compté par le préparateur
  unit: string;          // unité affichée (colis / kg…)
  ecart: number;         // realQty − sapQty
}

/**
 * Photo de l'entrepôt jointe à la fin du comptage. Stockée en data-URL JPEG
 * compressée CÔTÉ CLIENT (canvas, ~1280px, qualité ~0.7) — aucune infra de
 * stockage objet n'étant câblée, on reste cohérent avec le choix « tout en
 * JSON dans AppSetting ». Plafonnée en nombre et en taille (cf. sanitizePhotos).
 */
export interface InventoryPhoto {
  id: string;
  dataUrl: string;       // data:image/jpeg;base64,…
  bytes: number;         // poids décodé estimé
  w: number;
  h: number;
  caption?: string;      // libellé court optionnel (« Zone froide », « Quai 3 »)
  addedAt: string;
}

/**
 * Mouvement de régularisation posté dans SAP pour une ligne d'écart.
 * `sens` = "entree" (excédent → InventoryGenEntries) | "sortie" (manque →
 * InventoryGenExits). `qtyUnits` est en UNITÉS D'INVENTAIRE SAP (pie/kg), valeur
 * absolue ; `ecartColis` reste l'écart affiché (colis). `value` = qtyUnits ×
 * prix d'achat unitaire (positif). `lot` = EM<DocNum> affecté.
 */
export interface InventoryMove {
  itemCode: string;
  itemName: string;
  sens: "entree" | "sortie";
  ecartColis: number;
  unitsPerColis: number;
  qtyUnits: number;      // |écart| en unités SAP
  lot: string | null;    // EM<DocNum> (lot primaire — affichage / U_NoLot non-batch)
  unitPrice: number;     // €/unité d'inventaire
  value: number;         // qtyUnits × unitPrice (≥ 0)
  // Désignation (affichage récap : tags marque / condt / variété / pays).
  uPays?: string | null;
  uMarque?: string | null;
  uCondi?: string | null;
  frgnName?: string | null;
  /** Répartition par entrepôt RÉELLEMENT postée (vérifiée contre le stock miroir),
   *  avec le lot résolu pour CET entrepôt (batch × magasin cohérents). */
  warehouses?: { warehouse: string; qtyUnits: number; lot: string | null }[];
}

/** Trace de l'ajustement de stock SAP déclenché à la validation d'un inventaire. */
export interface InventoryAdjustment {
  status: "done" | "error";
  at: string;
  by: string;
  moves: InventoryMove[];
  nbSorties: number;
  nbEntrees: number;
  totalValue: number;            // somme nette des valeurs (€) : entrées − sorties
  demarqueValue: number;         // valeur des SORTIES (manques) = démarque inconnue (€)
  sapExitDocNum: number | null;  // InventoryGenExits
  sapExitEntry: number | null;
  sapEntryDocNum: number | null; // InventoryGenEntries
  sapEntryEntry: number | null;
  sapEnv: string;                // base SAP au moment de l'écriture ("prod"/"test")
  error?: string;
}

export interface InventorySession {
  id: string;
  status: "submitted" | "reviewed" | "adjusted";
  createdBy: string;     // email du préparateur
  note: string;
  lines: InventoryLine[];
  photos: InventoryPhoto[];
  nbEcarts: number;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** Dernière réouverture (« repasser dessus ») : reviewed → submitted. */
  reopenedAt?: string | null;
  reopenedBy?: string | null;
  /** Dernière correction / recomptage en place (PUT) : qui, quand. */
  updatedAt?: string | null;
  updatedBy?: string | null;
  /** Régularisation de stock SAP (posée une seule fois à la validation). */
  adjustment?: InventoryAdjustment | null;
  /** Pré-étape « commandes préparées » retirées du stock théorique. */
  prep?: InventoryPrep | null;
  /** Présent uniquement dans les réponses de LISTE (photos retirées du payload). */
  nbPhotos?: number;
}

/** Trace de la pré-étape : commandes GMS/Export/CHR (J+1…J+4) cochées « non préparées ». */
export interface InventoryPrep {
  preparedDocNums: number[];    // n° des commandes cochées (non préparées, encore en rayon)
  preparedDocEntries: number[]; // DocEntry correspondants
  addedColis: number;           // total colis réintégrés au stock théorique
  ordersScanned: number;        // nb de commandes proposées (fenêtre J+1…J+4)
  at: string;
}

/** Plafonds photos (UI + revalidation serveur). */
export const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 240 * 1024;       // ~240 Ko décodés / photo
const MAX_PHOTOS_TOTAL_BYTES = 1.6 * 1024 * 1024; // ~1.6 Mo cumulés

/** Estime le poids décodé (octets) d'une data-URL base64. */
function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : "";
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/**
 * Garde serveur : ne conserve que des data-URL image valides (jpeg/webp/png),
 * plafonne le nombre et la taille (par photo et cumulée), et (re)calcule les
 * métadonnées. Toute entrée malformée est silencieusement écartée.
 */
export function sanitizePhotos(
  raw: unknown,
  newId: () => string,
  now: () => string,
): InventoryPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: InventoryPhoto[] = [];
  let total = 0;
  for (const item of raw) {
    if (out.length >= MAX_PHOTOS) break;
    const p = item as Partial<InventoryPhoto> | null;
    const dataUrl = typeof p?.dataUrl === "string" ? p.dataUrl : "";
    if (!/^data:image\/(jpeg|webp|png);base64,/.test(dataUrl)) continue;
    const bytes = dataUrlBytes(dataUrl);
    if (bytes <= 0 || bytes > MAX_PHOTO_BYTES) continue;
    if (total + bytes > MAX_PHOTOS_TOTAL_BYTES) break;
    total += bytes;
    out.push({
      id: typeof p?.id === "string" && p.id ? p.id : newId(),
      dataUrl,
      bytes,
      w: Number.isFinite(p?.w) ? Math.round(p!.w as number) : 0,
      h: Number.isFinite(p?.h) ? Math.round(p!.h as number) : 0,
      caption: typeof p?.caption === "string" ? p.caption.trim().slice(0, 80) : undefined,
      addedAt: now(),
    });
  }
  return out;
}

/**
 * Rôle préparateur (« personne en charge du stock ») — désigné EXCLUSIVEMENT par
 * les admins / la direction depuis l'écran Effectifs (flag `User.isPreparateur`).
 * Plus aucun préparateur « système » codé en dur/env (cf. demande métier : seul
 * l'ADMIN garde un rôle bootstrap).
 *
 * Colonne lue en raw SQL (hors client Prisma typé tant que generate n'est pas
 * relancé) ; repli silencieux (false) si la colonne n'existe pas encore.
 */
export async function isPreparateur(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    const rows = await prisma.$queryRawUnsafe<{ isPreparateur: boolean | null }[]>(
      `SELECT "isPreparateur" FROM "User" WHERE LOWER("email") = $1 LIMIT 1`,
      email.trim().toLowerCase(),
    );
    return !!rows[0]?.isPreparateur;
  } catch {
    return false;
  }
}

export async function listSessions(): Promise<InventorySession[]> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
  const out: InventorySession[] = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r.value) as InventorySession); } catch { /* ignore ligne corrompue */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSession(id: string): Promise<InventorySession | null> {
  const r = await prisma.appSetting.findUnique({ where: { key: PREFIX + id } });
  if (!r) return null;
  try { return JSON.parse(r.value) as InventorySession; } catch { return null; }
}

export async function saveSession(s: InventorySession): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: PREFIX + s.id },
    update: { value: JSON.stringify(s) },
    create: { key: PREFIX + s.id, value: JSON.stringify(s) },
  });
}

/**
 * Statut de préparation issu de la DERNIÈRE pré-étape d'inventaire récente (≤ 2 j).
 * ⚠️ Dans la pré-étape, le préparateur coche les commandes **PAS encore préparées**
 * (« encore en rayon ») — stockées, malgré leur nom, dans `prep.preparedDocEntries`.
 * Donc, pour « Détail livraison » :
 *   • hasPrep=false → pas d'inventaire récent → aucune coche.
 *   • sinon : une commande est « FAITE » si elle n'est PAS dans `notPrepared`.
 * (Transitoire : recompté à chaque inventaire → on ne prend que la plus récente.)
 */
export async function getPrepStatus(): Promise<{ notPrepared: Set<number>; hasPrep: boolean }> {
  try {
    for (const s of await listSessions()) {       // tri décroissant par createdAt
      if (!s.prep) continue;
      const at = s.prep.at ?? s.createdAt;
      if (Date.now() - new Date(at).getTime() > 2 * 24 * 60 * 60 * 1000) break; // trop ancien
      return { notPrepared: new Set(s.prep.preparedDocEntries ?? []), hasPrep: true };
    }
  } catch { /* pas de trace */ }
  return { notPrepared: new Set(), hasPrep: false };
}

/* ───────────────────────── Statut « Faite » MANUEL ─────────────────────────
 * Le statut « faite » (commande préparée) d'un BL est désormais MANUEL : le
 * préparateur le bascule à la main sur « Détail livraison ». Stocké par DocEntry
 * dans AppSetting (clé `livfaite:<docEntry>`). Une commande n'est JAMAIS « faite »
 * tant qu'on ne l'a pas cochée (plus de déduction automatique depuis l'inventaire,
 * qui marquait tout à tort).
 */
const LIV_FAITE_PREFIX = "livfaite:";

/**
 * TOUS les statuts « Détail livraison » par DocEntry en UNE requête (au lieu de
 * 7 scans séquentiels de AppSetting — les 5 préfixes liv* sont lus d'un coup et
 * chaque ligne n'est parsée qu'une fois). Consommé par GET /api/livraisons.
 */
export async function getDeliveryStatuses(): Promise<{
  prepared: Map<number, boolean>;
  preparedBy: Map<number, string>;
  preparedAt: Map<number, string>;
  departed: Map<number, boolean>;
  departedBy: Map<number, string>;
  departedAt: Map<number, string>;
  preparer: Map<number, string>;
  incomplete: Map<number, boolean>;
  excluded: Map<number, boolean>;
}> {
  const out = {
    prepared: new Map<number, boolean>(),
    preparedBy: new Map<number, string>(),
    preparedAt: new Map<number, string>(),
    departed: new Map<number, boolean>(),
    departedBy: new Map<number, string>(),
    departedAt: new Map<number, string>(),
    preparer: new Map<number, string>(),
    incomplete: new Map<number, boolean>(),
    excluded: new Map<number, boolean>(),
  };
  const prefixes = [LIV_FAITE_PREFIX, LIV_DEPART_PREFIX, LIV_PREP_PREFIX, LIV_INCOMPLETE_PREFIX, LIV_AVOIR_PREFIX];
  try {
    const rows = await prisma.appSetting.findMany({
      where: { OR: prefixes.map((p) => ({ key: { startsWith: p } })) },
    });
    for (const r of rows) {
      const prefix = prefixes.find((p) => r.key.startsWith(p));
      if (!prefix) continue;
      const docEntry = Number(r.key.slice(prefix.length));
      if (!Number.isFinite(docEntry)) continue;
      let v: { prepared?: boolean; departed?: boolean; incomplete?: boolean; excluded?: boolean; by?: string; at?: string };
      try { v = JSON.parse(r.value); } catch { continue; }
      switch (prefix) {
        case LIV_FAITE_PREFIX:
          out.prepared.set(docEntry, !!v.prepared);
          if (v.prepared && v.by?.trim()) out.preparedBy.set(docEntry, v.by.trim());
          // Heure du DERNIER clic « fait » — affichée sur le bon.
          if (v.prepared && v.at) out.preparedAt.set(docEntry, v.at);
          break;
        case LIV_DEPART_PREFIX:
          out.departed.set(docEntry, !!v.departed);
          if (v.departed && v.by?.trim()) out.departedBy.set(docEntry, v.by.trim());
          // Heure du DERNIER clic « départ » — affichée sur le bon.
          if (v.departed && v.at) out.departedAt.set(docEntry, v.at);
          break;
        case LIV_PREP_PREFIX:
          if (v.by?.trim()) out.preparer.set(docEntry, v.by.trim());
          break;
        case LIV_INCOMPLETE_PREFIX:
          if (v.incomplete) out.incomplete.set(docEntry, true);
          break;
        case LIV_AVOIR_PREFIX:
          out.excluded.set(docEntry, !!v.excluded);
          break;
      }
    }
  } catch { /* table absente → aucune marque */ }
  return out;
}

/** Bascule le statut « faite » d'un BL (persisté). Renvoie l'heure du clic. */
export async function setDeliveryPrepared(docEntry: number, prepared: boolean, by: string): Promise<string> {
  const key = LIV_FAITE_PREFIX + docEntry;
  const at = new Date().toISOString();
  const value = JSON.stringify({ prepared, at, by });
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return at;
}

/** Change l'AUTEUR du « fait » d'un BL déjà préparé (« Fait par … ») — l'heure
 *  du clic d'origine est CONSERVÉE. Renvoie false si le BL n'est pas « faite ». */
export async function setDeliveryPreparedBy(docEntry: number, by: string): Promise<boolean> {
  const key = LIV_FAITE_PREFIX + docEntry;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return false;
  let v: { prepared?: boolean; at?: string; by?: string };
  try { v = JSON.parse(row.value); } catch { return false; }
  if (!v.prepared) return false;
  await prisma.appSetting.update({ where: { key }, data: { value: JSON.stringify({ ...v, by }) } });
  return true;
}

/** Statut « faite » d'UN BL (lecture ciblée) — { prepared, by } ou null si jamais marqué. */
export async function getDeliveryPreparedOne(docEntry: number): Promise<{ prepared: boolean; by: string | null } | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: LIV_FAITE_PREFIX + docEntry } });
    if (!row) return null;
    const v = JSON.parse(row.value) as { prepared?: boolean; by?: string };
    return { prepared: !!v.prepared, by: v.by?.trim() || null };
  } catch {
    return null;
  }
}

/* ───────────────────────── Statut « Départ » (livraison) ─────────────────────
 * 3ᵉ état après « faite » : la commande est PARTIE en livraison (chargée). Marqué
 * manuellement (livreur / admin) sur « Détail livraison ». Stocké par DocEntry
 * dans AppSetting (clé `livdepart:<docEntry>`, valeur = { departed, at, by }).
 */
const LIV_DEPART_PREFIX = "livdepart:";

/** Bascule le statut « départ » d'un BL (persisté). Renvoie l'heure du clic. */
export async function setDeliveryDeparted(docEntry: number, departed: boolean, by: string): Promise<string> {
  const key = LIV_DEPART_PREFIX + docEntry;
  const at = new Date().toISOString();
  const value = JSON.stringify({ departed, at, by });
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return at;
}

/* ──────────────────── BL « préparateur affecté » ────────────────────
 * Le préparateur qui ouvre une commande en grand se l'affecte. Persisté par
 * DocEntry (clé `livprep:<docEntry>`, valeur = { by, at }).
 */
const LIV_PREP_PREFIX = "livprep:";

/** Préparateur affecté à UN BL (lecture ciblée) — nom/email, ou null si aucun. */
export async function getDeliveryPreparerOne(docEntry: number): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: LIV_PREP_PREFIX + docEntry } });
    if (!row) return null;
    return (JSON.parse(row.value) as { by?: string }).by?.trim() || null;
  } catch {
    return null;
  }
}

/** Affecte (by non vide) ou retire (by vide/null) le préparateur d'un BL. */
export async function setDeliveryPreparer(docEntry: number, by: string | null): Promise<void> {
  const key = LIV_PREP_PREFIX + docEntry;
  if (!by || !by.trim()) {
    try { await prisma.appSetting.delete({ where: { key } }); } catch { /* déjà absent */ }
    return;
  }
  const value = JSON.stringify({ by: by.trim(), at: new Date().toISOString() });
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/* ──────────────────── BL « incomplète — à reprendre » ────────────────────
 * Une commande renvoyée sur la file car PAS entièrement préparée est signalée
 * (clé `livincomplete:<docEntry>`). Sert de notification dans le Détail livraison.
 */
const LIV_INCOMPLETE_PREFIX = "livincomplete:";

/** Signale (true) ou lève (false) le statut « incomplète — à reprendre » d'un BL. */
export async function setDeliveryIncomplete(docEntry: number, incomplete: boolean, by?: string): Promise<void> {
  const key = LIV_INCOMPLETE_PREFIX + docEntry;
  if (!incomplete) {
    try { await prisma.appSetting.delete({ where: { key } }); } catch { /* déjà absent */ }
    return;
  }
  const value = JSON.stringify({ incomplete: true, at: new Date().toISOString(), by: by ?? null });
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/* ──────────────────── BL « avoir / exclu » (déduction 100%) ────────────────────
 * Un BL totalement avoiré (facturé puis avoir total) ou en doublon est marqué
 * MANUELLEMENT « avoir » : il est alors DÉDUIT à 100% des totaux du Détail
 * livraison (et affiché grisé). Persisté par DocEntry (clé `livavoir:<docEntry>`).
 */
const LIV_AVOIR_PREFIX = "livavoir:";

/** Bascule le statut « avoir / exclu » d'un BL (persisté). */
export async function setDeliveryExcluded(docEntry: number, excluded: boolean, by: string): Promise<void> {
  const key = LIV_AVOIR_PREFIX + docEntry;
  const value = JSON.stringify({ excluded, at: new Date().toISOString(), by });
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
