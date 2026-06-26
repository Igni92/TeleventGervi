/**
 * Catalogue des TRANSPORTEURS — UDO SAP `SERGTRS`.
 *
 * Découverte (diag /api/sap/diag/transport) : `SERGTRS` est l'objet
 * « transporteurs » exposé par le Service Layer (clé `Code` = le code
 * transporteur, = la valeur portée par `ORDR.U_TrspCode`). Structure :
 *
 *   En-tête (1 par transporteur) :
 *     Code        → code transporteur (ex. "ANTOINE", "DELANCHY FT86")
 *     Name        → libellé
 *     U_Timbre    → TIMBRE du transporteur (montant, ex. 14.5) → ORDR.U_Timbre
 *     Canceled    → 'Y' = annulé (exclu)
 *   SERG_TRS1Collection → les TOURNÉES du transporteur :
 *     U_Nom   → nom de la tournée (ex. "NORD", "IDF 1")
 *     U_Des   → repère/département (ex. "62", "91", "SCA")
 *     U_Heure → heure de la tournée (ex. "10:30:00") → ORDR.U_TrspHeur
 *     U_Active→ 'Y'/'O' = active
 *   (SERG_TRS2 = adresses, SERG_TRS3 = contacts — non utilisés ici.)
 *
 * ⚠️ Les collections enfant ne sont PAS renvoyées par la liste ($filter) : il
 * faut un GET unitaire `SERGTRS('<Code>')` (children inlinés). Le $expand sur la
 * liste n'est pas fiable sur cette base — on lit donc par code, avec cache.
 *
 * Mapping BL (cible) :
 *   ORDR.U_TrspCode ← Transporteur.code
 *   ORDR.U_TrspHeur ← Tournee.heure (tournée choisie)   ⚠️ champ SAP SANS « e »
 *   ORDR.U_Timbre   ← Transporteur.timbre (en-tête, par transporteur)
 *
 * Lecture PROD (référentiel), comme lib/clientCarriers.
 */
import { sap } from "@/lib/sapb1";

export type Tournee = {
  lineId: number;
  nom: string;          // U_Nom
  des: string;          // U_Des (département / repère)
  heure: string | null; // U_Heure ("HH:MM:SS") → U_TrspHeur
};

export type Transporteur = {
  code: string;          // SERGTRS.Code → U_TrspCode
  name: string;          // SERGTRS.Name
  timbre: number;        // SERGTRS.U_Timbre → U_Timbre
};

export type TransporteurDetail = Transporteur & { tournees: Tournee[] };

const LIST_TTL_MS = 30 * 60 * 1000;   // catalogue transporteurs (en-têtes)
const DETAIL_TTL_MS = 30 * 60 * 1000; // tournées par transporteur

type SergHeader = { Code?: string; Name?: string | null; U_Timbre?: number | null; Canceled?: string | null };
type SergLine1 = { LineId?: number; U_Nom?: string | null; U_Des?: string | null; U_Heure?: string | null; U_Active?: string | null };
type SergFull = SergHeader & { SERG_TRS1Collection?: SergLine1[] };

let listCache: { at: number; data: Transporteur[] } | null = null;
const detailCache = new Map<string, { at: number; data: TransporteurDetail }>();

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v ?? "").toString().trim();
const isActive = (v: unknown): boolean => ["Y", "O"].includes(str(v).toUpperCase());

/** Clé OData pour un GET unitaire SERGTRS('<Code>') (Code peut contenir des espaces). */
function sergKey(code: string): string {
  return `SERGTRS(${encodeURIComponent(`'${code.replace(/'/g, "''")}'`)})`;
}

/** Catalogue des transporteurs (en-têtes), hors annulés et hors placeholder « * ». */
export async function getTransporteurs(): Promise<Transporteur[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.data;
  const rows = await sap.getAll<SergHeader>("SERGTRS", { env: "prod", pageSize: 200, maxPages: 5 });
  const data = rows
    .filter((r) => str(r.Code) && str(r.Code) !== "*" && str(r.Canceled).toUpperCase() !== "Y")
    .map((r) => ({ code: str(r.Code), name: str(r.Name) || str(r.Code), timbre: num(r.U_Timbre) }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  listCache = { at: Date.now(), data };
  return data;
}

/** Transporteur + ses tournées actives (GET unitaire, children inlinés). */
export async function getTransporteurDetail(code: string): Promise<TransporteurDetail | null> {
  const key = str(code);
  if (!key) return null;
  const hit = detailCache.get(key.toUpperCase());
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.data;

  let obj: SergFull;
  try {
    obj = await sap.get<SergFull>(sergKey(key), { env: "prod" });
  } catch {
    return null;
  }
  const tournees: Tournee[] = (obj.SERG_TRS1Collection ?? [])
    .filter((l) => isActive(l.U_Active))
    .map((l) => ({ lineId: num(l.LineId), nom: str(l.U_Nom), des: str(l.U_Des), heure: str(l.U_Heure) || null }));
  const data: TransporteurDetail = {
    code: str(obj.Code) || key,
    name: str(obj.Name) || key,
    timbre: num(obj.U_Timbre),
    tournees,
  };
  detailCache.set(key.toUpperCase(), { at: Date.now(), data });
  return data;
}

/** Timbre d'un transporteur (en-tête) — null si introuvable. Pour l'écriture BL. */
export async function getTransporteurTimbre(code: string): Promise<number | null> {
  const detail = await getTransporteurDetail(code);
  return detail ? detail.timbre : null;
}

/** Vide les caches (tests / debug). */
export function _resetTransporteursCache(): void {
  listCache = null;
  detailCache.clear();
}
