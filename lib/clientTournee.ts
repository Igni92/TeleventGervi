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

/** "LPOI." (variante SCACHAP) → "LPOI" (client SAP de base). Inchangé si le
 *  code n'a pas de suffixe point (cf. isDotVariant/foldDotVariant, import SAP). */
const baseCardCode = (cardCode: string) => cardCode.trim().replace(/\.+$/, "");

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

/**
 * Tournée mémorisée d'un client, ou null.
 * Repli sur le code de BASE si le CardCode est une variante SCACHAP ("LPOI.") sans
 * mémoire propre : c'est le MÊME client / la même tournée de livraison, seul le
 * compte SAP facturé diffère — sans ce repli, la tournée mémorisée sur "LPOI"
 * (compte Direct) n'était jamais reprise pour les BL partis sur "LPOI." (SCACHAP),
 * qui repartaient donc sans tournée (à saisir à la main à chaque fois).
 */
export async function getClientTournee(cardCode: string): Promise<ClientTournee | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: key(cardCode) } });
  const own = row ? parse(row.value) : null;
  if (own) return own;
  const base = baseCardCode(cardCode);
  if (base === cardCode.trim()) return null;
  const baseRow = await prisma.appSetting.findUnique({ where: { key: key(base) } });
  return baseRow ? parse(baseRow.value) : null;
}

/** Tournées mémorisées pour plusieurs clients (bulk) → Map(CARDCODE → tournée).
 *  Repli code de base par entrée manquante — cf. getClientTournee. */
export async function getClientTournees(cardCodes: string[]): Promise<Map<string, ClientTournee>> {
  const out = new Map<string, ClientTournee>();
  const wanted = [...new Set(cardCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) return out;
  const keys = [...new Set(wanted.map((c) => key(c)))];
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  const byCode = new Map<string, ClientTournee>();
  for (const r of rows) {
    const t = parse(r.value);
    if (t) byCode.set(r.key.slice(PREFIX.length), t);
  }
  const missingBases: string[] = [];
  for (const code of wanted) {
    const own = byCode.get(code);
    if (own) { out.set(code, own); continue; }
    const base = baseCardCode(code).toUpperCase();
    if (base !== code) missingBases.push(base);
  }
  if (missingBases.length) {
    const baseKeys = [...new Set(missingBases.map((c) => key(c)))];
    const baseRows = await prisma.appSetting.findMany({ where: { key: { in: baseKeys } } });
    const baseByCode = new Map<string, ClientTournee>();
    for (const r of baseRows) {
      const t = parse(r.value);
      if (t) baseByCode.set(r.key.slice(PREFIX.length), t);
    }
    for (const code of wanted) {
      if (out.has(code)) continue;
      const base = baseCardCode(code).toUpperCase();
      const t = baseByCode.get(base);
      if (t) out.set(code, t);
    }
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
