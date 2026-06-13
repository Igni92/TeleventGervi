import { sap } from "@/lib/sapb1";

/**
 * Moteur de prix conseillé Gervifrais.
 *
 * Règle (décodée + confirmée) :
 *   PrixConseillé = PrixAchat × Coef
 *   • PrixAchat  = liste de prix SAP n°2 (ItemPrices PriceList 2)
 *   • Coef       = BusinessPartnerGroups(<groupe client>).U_MB_<catégorie>
 *                  si renseigné, sinon COEF_DEFAUT (1.5)
 *   • Catégorie  = déduite du groupe article (Fraises / Fruits_Rges / Legumes / …)
 *   • Fraises    = coef par palier de prix d'achat (U_MB_Fraises_0_3 / _3_5 / _5_8 / _8_999)
 *
 * ⚠️ Indicatif (aide à la saisie) — le prix réel reste libre / appliqué par SAP.
 */

export const COEF_DEFAUT = 1.5;
export const PURCHASE_PRICE_LIST = 2;

type Category =
  | "Fraises" | "Fruits_Rges" | "Legumes" | "Fruits_Prep"
  | "Divers_Fruits" | "Fruits_Secs" | "Autres";

/** Mappe un nom de groupe article SAP vers une catégorie de coefficient. */
export function categoryFromGroupName(name?: string | null): Category | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/fraise/.test(n)) return "Fraises";
  if (/fruits?\s*rouges?|framboise|myrtille|m[uû]re|groseille|cassis/.test(n)) return "Fruits_Rges";
  if (/l[ée]gume/.test(n)) return "Legumes";
  if (/pr[ée]par/.test(n)) return "Fruits_Prep";
  if (/secs?|amande|datte|noix|noisette|pruneau|abricot sec/.test(n)) return "Fruits_Secs";
  // Agrumes, exotiques, etc. → fruits divers
  if (/agrume|exotiqu|banane|ananas|mangue|kiwi|raisin|pomme|poire|p[êe]che|prune|cerise|figue|melon|brugnon|nectarine/.test(n)) return "Divers_Fruits";
  return null;
}

// ── Caches module-level (10 min) ──────────────────────────────
const TTL = 10 * 60 * 1000;

let itemGroupsCache: { at: number; map: Map<number, string> } | null = null;
async function getItemGroupNames(): Promise<Map<number, string>> {
  if (itemGroupsCache && Date.now() - itemGroupsCache.at < TTL) return itemGroupsCache.map;
  const map = new Map<number, string>();
  try {
    const r = await sap.get<{ value: { Number: number; GroupName: string }[] }>(
      "ItemGroups?$select=Number,GroupName&$top=400",
      { env: "prod" },
    );
    for (const g of (r.value || [])) map.set(g.Number, g.GroupName);
    itemGroupsCache = { at: Date.now(), map };
  } catch { if (itemGroupsCache) return itemGroupsCache.map; }
  return map;
}

type BpGroupCoefs = {
  base: Partial<Record<Category, number>>;
  fraiseBands: { b0_3?: number; b3_5?: number; b5_8?: number; b8_999?: number };
  limite?: number; plafond?: number;
};
const bpGroupCache = new Map<number, { at: number; data: BpGroupCoefs }>();
async function getBpGroupCoefs(groupCode: number): Promise<BpGroupCoefs> {
  const cached = bpGroupCache.get(groupCode);
  if (cached && Date.now() - cached.at < TTL) return cached.data;
  const data: BpGroupCoefs = { base: {}, fraiseBands: {} };
  try {
    const g = await sap.get<Record<string, number | null>>(`BusinessPartnerGroups(${groupCode})`, { env: "prod" });
    const cats: Category[] = ["Fraises","Fruits_Rges","Legumes","Fruits_Prep","Divers_Fruits","Fruits_Secs","Autres"];
    for (const c of cats) { const v = g[`U_MB_${c}`]; if (v != null && v !== 0) data.base[c] = v as number; }
    data.fraiseBands = {
      b0_3: g.U_MB_Fraises_0_3 ?? undefined, b3_5: g.U_MB_Fraises_3_5 ?? undefined,
      b5_8: g.U_MB_Fraises_5_8 ?? undefined, b8_999: g.U_MB_Fraises_8_999 ?? undefined,
    };
    data.limite = g.U_Limite ?? undefined; data.plafond = g.U_Plafond ?? undefined;
    bpGroupCache.set(groupCode, { at: Date.now(), data });
  } catch { if (cached) return cached.data; }
  return data;
}

/** Coefficient fraise par palier de prix d'achat. */
function fraiseBandCoef(bands: BpGroupCoefs["fraiseBands"], achat: number): number | undefined {
  if (achat < 3) return bands.b0_3 || undefined;
  if (achat < 5) return bands.b3_5 || undefined;
  if (achat < 8) return bands.b5_8 || undefined;
  return bands.b8_999 || undefined;
}

export interface SuggestedPrice {
  itemCode: string;
  prixAchat: number | null;
  coef: number;
  prixConseille: number | null;
  category: Category | null;
  isDefault: boolean;          // true = coef 1.5 par défaut (pas de tarif groupe spécifique)
  // Attributs produit (#37)
  marque: string | null;
  calibre: string | null;
  pays: string | null;
}

type SapItemForPrice = {
  ItemCode: string;
  ItemsGroupCode?: number;
  ItemPrices?: { PriceList: number; Price: number }[];
  U_GER_Marque?: string; U_GER_CALIBRE?: string; U_Pays?: string;
};

/**
 * Calcule le prix conseillé + attributs pour une liste d'articles, selon le groupe client.
 * @param groupCode  code du groupe client SAP (BusinessPartner.GroupCode)
 */
export async function getSuggestedPrices(
  itemCodes: string[],
  groupCode: number | null,
): Promise<Record<string, SuggestedPrice>> {
  const out: Record<string, SuggestedPrice> = {};
  if (itemCodes.length === 0) return out;

  const [groupNames, coefs] = await Promise.all([
    getItemGroupNames(),
    groupCode != null ? getBpGroupCoefs(groupCode) : Promise.resolve<BpGroupCoefs>({ base: {}, fraiseBands: {} }),
  ]);

  // Récupère les articles (prix d'achat + attributs) par lots de 20
  const items: SapItemForPrice[] = [];
  const CHUNK = 20;
  for (let i = 0; i < itemCodes.length; i += CHUNK) {
    const slice = itemCodes.slice(i, i + CHUNK);
    const filter = "(" + slice.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ") + ")";
    try {
      const r = await sap.get<{ value: SapItemForPrice[] }>(
        `Items?$filter=${encodeURIComponent(filter)}&$select=ItemCode,ItemsGroupCode,ItemPrices,U_GER_Marque,U_GER_CALIBRE,U_Pays&$top=50`,
        { env: "prod" },
      );
      items.push(...(r.value || []));
    } catch { /* ignore le lot en échec */ }
  }

  for (const it of items) {
    const achat = it.ItemPrices?.find((p) => p.PriceList === PURCHASE_PRICE_LIST)?.Price ?? null;
    const category = categoryFromGroupName(groupNames.get(it.ItemsGroupCode ?? -1));
    // Coefficient : spécifique groupe (par catégorie, paliers fraises) sinon défaut 1.5
    let coef: number | undefined;
    if (category === "Fraises" && achat != null) coef = fraiseBandCoef(coefs.fraiseBands, achat) ?? coefs.base.Fraises;
    else if (category) coef = coefs.base[category];
    const isDefault = coef == null;
    const finalCoef = coef ?? COEF_DEFAUT;
    out[it.ItemCode] = {
      itemCode: it.ItemCode,
      prixAchat: achat,
      coef: finalCoef,
      prixConseille: achat != null ? Math.round(achat * finalCoef * 100) / 100 : null,
      category,
      isDefault,
      marque: it.U_GER_Marque || null,
      calibre: it.U_GER_CALIBRE || null,
      pays: it.U_Pays || null,
    };
  }
  return out;
}
