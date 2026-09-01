// Module Transporteur — constantes métier partagées (statuts, canaux, cycle de
// clic, référence de suivi). Aucune dépendance SAP. Voir MODULE-TRANSPORTEUR.md.

export const TRANSPORT_STATUTS = ["A_PREPARER", "PREPAREE", "EXPEDIE", "LIVREE", "INCIDENT"] as const;
export type TransportStatut = (typeof TRANSPORT_STATUTS)[number];

export const STATUT_LABEL: Record<string, string> = {
  A_PREPARER: "À préparer",
  PREPAREE: "Préparée",
  EXPEDIE: "Expédié",
  LIVREE: "Livrée",
  INCIDENT: "Incident",
};

/** Cycle NOMINAL au clic sur la cartouche (§Annexe A : « interaction en boucle »).
 *  À préparer → Préparée → Expédié → (retour) À préparer. Livrée/Incident hors
 *  boucle (posés depuis la feuille de route / le menu incident). */
export const NEXT_CLICK_STATUT: Record<string, TransportStatut> = {
  A_PREPARER: "PREPAREE",
  PREPAREE: "EXPEDIE",
  EXPEDIE: "A_PREPARER",
};

export const CANAUX = ["EXPORT", "GMS", "DIRECT"] as const;
export const CANAL_LABEL: Record<string, string> = { EXPORT: "Export", GMS: "GMS", DIRECT: "Direct Rungis" };
/** Tri d'affichage : EXPORT en premier (départ avant 6h30), puis GMS, puis Direct. */
export const CANAL_ORDER: Record<string, number> = { EXPORT: 0, GMS: 1, DIRECT: 2 };

/** Canal déduit du type client TeleVente (pré-remplissage depuis les BL). */
export function canalFromClientType(type?: string | null): string {
  const t = (type ?? "").trim().toUpperCase();
  if (t === "EXPORT") return "EXPORT";
  if (t === "GMS") return "GMS";
  return "DIRECT"; // CHR / comptoir / autres → Direct Rungis par défaut
}

export function refSuiviPrefix(canal: string): string {
  return canal === "EXPORT" ? "EX" : canal === "GMS" ? "GM" : "DR";
}

/** Candidat de référence de suivi (ex. EX-1041) — unicité garantie côté route
 *  par retry sur conflit. */
export function makeRefSuivi(canal: string): string {
  return `${refSuiviPrefix(canal)}-${Math.floor(1000 + Math.random() * 9000)}`;
}
