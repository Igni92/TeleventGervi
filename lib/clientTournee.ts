/**
 * Mémoire de la TOURNÉE par client (autonome, sans SERG_TRCL).
 *
 * L'affectation client→transporteur→tournée vit dans SAP (SERG_TRCL) mais n'est
 * pas lisible par notre compte Service Layer. En attendant, l'app la MÉMORISE :
 * dès qu'on choisit la tournée d'un client dans « Détail livraison », on la
 * retient ici et on la ré-applique automatiquement aux prochaines commandes
 * (transporteur + heure `U_TrspHeur` + timbre) — y compris à la création.
 *
 * Stockage : AppSetting, clé `cltour:<CARDCODE>` → JSON (zéro migration).
 * Le jour où SERG_TRCL devient lisible, on bascule sur la donnée SAP sans rien
 * changer pour l'utilisateur (cette mémoire sert alors de repli/override).
 */
import { prisma } from "@/lib/prisma";

export type ClientTournee = {
  trspCode: string;        // transporteur (U_TrspCode)
  heure: string | null;    // heure de tournée (U_TrspHeur, "HH:MM:SS")
  nom?: string | null;     // nom de la tournée (affichage) — ex. "NORD"
  des?: string | null;     // repère/département — ex. "62"
  lineId?: number | null;  // LineId SERGTRS de la tournée (désambiguïse les heures égales)
};

const PREFIX = "cltour:";
const key = (cardCode: string) => PREFIX + cardCode.trim().toUpperCase();

function parse(value: string): ClientTournee | null {
  try {
    const o = JSON.parse(value) as Partial<ClientTournee>;
    if (!o || typeof o.trspCode !== "string" || !o.trspCode) return null;
    return {
      trspCode: o.trspCode,
      heure: typeof o.heure === "string" && o.heure ? o.heure : null,
      nom: o.nom ?? null,
      des: o.des ?? null,
      lineId: typeof o.lineId === "number" ? o.lineId : null,
    };
  } catch {
    return null;
  }
}

/** Tournée mémorisée d'un client, ou null. */
export async function getClientTournee(cardCode: string): Promise<ClientTournee | null> {
  const k = key(cardCode);
  const row = await prisma.appSetting.findUnique({ where: { key: k } });
  return row ? parse(row.value) : null;
}

/** Tournées mémorisées pour plusieurs clients (bulk) → Map(CARDCODE → tournée). */
export async function getClientTournees(cardCodes: string[]): Promise<Map<string, ClientTournee>> {
  const out = new Map<string, ClientTournee>();
  const keys = [...new Set(cardCodes.map((c) => key(c)))];
  if (!keys.length) return out;
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  for (const r of rows) {
    const t = parse(r.value);
    if (t) out.set(r.key.slice(PREFIX.length), t);
  }
  return out;
}

/** Mémorise (ou met à jour) la tournée d'un client. `null` efface la mémoire. */
export async function setClientTournee(cardCode: string, t: ClientTournee | null): Promise<void> {
  const k = key(cardCode);
  if (!t || !t.trspCode) {
    try { await prisma.appSetting.delete({ where: { key: k } }); } catch { /* déjà absent */ }
    return;
  }
  const value = JSON.stringify({
    trspCode: t.trspCode,
    heure: t.heure ?? null,
    nom: t.nom ?? null,
    des: t.des ?? null,
    lineId: t.lineId ?? null,
  });
  await prisma.appSetting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } });
}
