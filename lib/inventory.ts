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
  lot: string | null;    // EM<DocNum>
  unitPrice: number;     // €/unité d'inventaire
  value: number;         // qtyUnits × unitPrice (≥ 0)
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
