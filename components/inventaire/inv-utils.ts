/**
 * Utilitaires de l'inventaire guidé (partagés entre les écrans du flux).
 * Pur côté logique ; `compressImage` n'utilise les API navigateur qu'à l'appel
 * (jamais à l'import) → importable depuis n'importe quel composant client.
 */
import { colisInfo } from "@/lib/colis";

export type Product = {
  id: string;
  itemCode: string;
  itemName: string;
  groupName: string | null;
  salesQtyPerPackUnit: number | null;
  salesUnit: string | null;
  salesUnitWeight: number | null;
  uPays: string | null;
  uMarque: string | null;
  uCondi: string | null;
  uUvc?: string | null;
  frgnName?: string | null;
  stockByWarehouse: Record<string, { available: number; inStock: number }>;
};

/** Photo en cours de saisie côté client (avant envoi). Compatible InventoryPhoto. */
export type DraftPhoto = {
  id: string;
  dataUrl: string;
  bytes: number;
  w: number;
  h: number;
};

/** Plafond UI de photos (le serveur revalide dans sanitizePhotos). */
export const MAX_PHOTOS = 6;

export const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const fmtDate = (s: string) =>
  new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Stock SAP « réel » (PHYSIQUE) exprimé EXCLUSIVEMENT en COLIS. On part du
 * `inStock` (marchandise physiquement présente) et NON du disponible : les
 * réservations (committed) ne sortent pas la marchandise tant que le BL n'est pas
 * posté → Hugo les compte. Le stock théorique se déduit ensuite côté écran en
 * RETIRANT les commandes déjà PRÉPARÉES (marchandise sur le quai / partie).
 * Conversion via le diviseur exact `unitsPerColis` (lib/colis, source unique
 * partagée avec la régularisation SAP).
 */
export function sapInfo(p: Product): { qty: number; unit: string } {
  const inStock = ["000", "01", "R1"].reduce((s, w) => s + (p.stockByWarehouse[w]?.inStock ?? 0), 0);
  const { unitsPerColis } = colisInfo({
    salesUnit: p.salesUnit,
    salesQtyPerPackUnit: p.salesQtyPerPackUnit,
    salesUnitWeight: p.salesUnitWeight,
  });
  return { qty: Math.round((inStock / unitsPerColis) * 10) / 10, unit: "colis" };
}

/** Écart (réel − SAP), arrondi 0,1. null si non compté. */
export function ecartOf(real: number | null | undefined, sapQty: number): number | null {
  if (real == null || !Number.isFinite(real)) return null;
  return Math.round((real - sapQty) * 10) / 10;
}

/* --------------------------------------------------------------------------
 * Emoji « fruit » — rend le comptage VISUEL. Devine d'après le nom/famille.
 * Best-effort : un défaut neutre (🧺) si rien ne matche.
 * ------------------------------------------------------------------------ */
const EMOJI_MAP: Array<[RegExp, string]> = [
  [/framboise/i, "🫐"], [/myrtille|bleuet/i, "🫐"], [/fraise/i, "🍓"], [/cerise|griotte/i, "🍒"],
  [/mure|mûre/i, "🫐"], [/groseille|cassis/i, "🍇"], [/raisin/i, "🍇"],
  [/abricot/i, "🍑"], [/pêche|peche|nectarine|brugnon/i, "🍑"], [/prune|reine.?claude|mirabelle|quetsche/i, "🟣"],
  [/pomme/i, "🍎"], [/poire/i, "🍐"], [/kiwi/i, "🥝"], [/banane/i, "🍌"],
  [/orange|maltaise/i, "🍊"], [/clementine|clémentine|mandarine/i, "🍊"], [/citron vert|lime/i, "🟢"], [/citron/i, "🍋"],
  [/pamplemousse|pomelo/i, "🍊"], [/ananas/i, "🍍"], [/mangue/i, "🥭"], [/melon/i, "🍈"], [/pasteque|pastèque/i, "🍉"],
  [/figue/i, "🟣"], [/grenade/i, "🔴"], [/litchi|lychee/i, "🔴"], [/fruit.?de.?la.?passion|passion|maracuja/i, "🟡"],
  [/avocat/i, "🥑"], [/tomate/i, "🍅"], [/fraise.?des.?bois/i, "🍓"],
  [/coco|noix de coco/i, "🥥"], [/datte/i, "🟤"], [/papaye/i, "🟠"],
  [/salade|mâche|mache|roquette/i, "🥬"], [/champignon/i, "🍄"], [/herbe|menthe|basilic|persil/i, "🌿"],
];
export function fruitEmoji(p: { itemName?: string | null; groupName?: string | null }): string {
  const hay = `${p.itemName ?? ""} ${p.groupName ?? ""}`;
  for (const [re, e] of EMOJI_MAP) if (re.test(hay)) return e;
  return "🧺";
}

/* --------------------------------------------------------------------------
 * Regroupement par FAMILLE (pour proposer « petit à petit »).
 * ------------------------------------------------------------------------ */
export type Family = {
  key: string;
  name: string;
  emoji: string;
  products: Product[];
  totalSap: number;
};

const FAMILY_FALLBACK = "Autres";

/**
 * Trie les produits et les groupe par famille (groupName). Familles ordonnées
 * par nombre de références décroissant ; produits d'une famille par stock SAP
 * décroissant. Renvoie aussi la liste APLATIE (ordre de parcours guidé).
 */
export function buildFamilies(products: Product[]): { families: Family[]; ordered: Product[] } {
  const byKey = new Map<string, Product[]>();
  for (const p of products) {
    const name = (p.groupName ?? "").trim() || FAMILY_FALLBACK;
    const arr = byKey.get(name) ?? [];
    arr.push(p);
    byKey.set(name, arr);
  }
  const families: Family[] = [...byKey.entries()].map(([name, arr]) => {
    const sorted = [...arr].sort((a, b) => sapInfo(b).qty - sapInfo(a).qty || a.itemName.localeCompare(b.itemName));
    return {
      key: name,
      name,
      emoji: fruitEmoji({ itemName: sorted[0]?.itemName, groupName: name }),
      products: sorted,
      totalSap: sorted.reduce((s, p) => s + sapInfo(p).qty, 0),
    };
  });
  // « Autres » toujours en dernier ; le reste par nb de réfs décroissant puis nom.
  families.sort((a, b) => {
    if (a.key === FAMILY_FALLBACK) return 1;
    if (b.key === FAMILY_FALLBACK) return -1;
    return b.products.length - a.products.length || a.name.localeCompare(b.name);
  });
  const ordered = families.flatMap((f) => f.products);
  return { families, ordered };
}

/* --------------------------------------------------------------------------
 * Compression image CÔTÉ CLIENT (canvas) — produit un JPEG sous un budget
 * d'octets décodés (cohérent avec sanitizePhotos côté serveur).
 * ------------------------------------------------------------------------ */
function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : "";
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

async function loadDrawable(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; cleanup: () => void }> {
  // Voie rapide : createImageBitmap (gère l'orientation EXIF si supportée).
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return { src: bmp, w: bmp.width, h: bmp.height, cleanup: () => bmp.close() };
  } catch {
    /* fallback <img> */
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("image illisible"));
    i.src = url;
  });
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
}

/**
 * Compresse une image en data-URL JPEG sous `maxBytes` (décodés). Réduit
 * d'abord la qualité, puis la dimension si nécessaire. `id` aléatoire fourni
 * par l'appelant (Math.random interdit dans les workflows mais OK ici client).
 */
export async function compressImage(
  file: File,
  id: string,
  opts?: { maxDim?: number; maxBytes?: number },
): Promise<DraftPhoto> {
  const maxBytes = opts?.maxBytes ?? 235 * 1024;
  let dim = opts?.maxDim ?? 1280;
  const { src, w, h, cleanup } = await loadDrawable(file);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, dim / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas indisponible");
      ctx.drawImage(src, 0, 0, cw, ch);
      for (const q of [0.72, 0.6, 0.5, 0.42]) {
        const dataUrl = canvas.toDataURL("image/jpeg", q);
        const bytes = dataUrlBytes(dataUrl);
        if (bytes <= maxBytes) return { id, dataUrl, bytes, w: cw, h: ch };
      }
      dim = Math.round(dim * 0.8); // toujours trop lourd → on réduit la dimension
    }
    // Dernier recours : la plus petite version qu'on ait produite.
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, dim / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(src, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.4);
    return { id, dataUrl, bytes: dataUrlBytes(dataUrl), w: canvas.width, h: canvas.height };
  } finally {
    cleanup();
  }
}
