/**
 * COÛT DE TRANSPORT PAR DOCUMENT (« position ») — base UNIQUE du net transport
 * (prime commerciaux, détail commissions, palmarès magasins).
 *
 * Transporteur d'un document — chaîne de résolution :
 *   1. `trspCode` RÉEL mirroré sur le doc (UDF SAP U_TrspCode) — la vérité ;
 *   2. repli : tournée HABITUELLE mémorisée du client (`cltour:`) ;
 *   3. sinon : inconnu → coût 0, signalé `mode: "aucun"` (on ne devine pas).
 *
 * Coût selon le transporteur (uniquement si du poids a été livré) :
 *   • DIRECT (flotte propre) → coût PAR POSITION (charges annuelles ÷ nb de
 *     livraisons ≈ 25 €/position) : un arrêt de tournée coûte pareil à 5 kg
 *     qu'à 500 kg — le €/kg lissé n'est qu'une référence (décision Coût de
 *     transport / prix par position). Repli €/kg si le modèle n'a pas de
 *     nb de livraisons saisi.
 *   • Externe AVEC grille → coût par position (zone département × tranche kg).
 *   • Externe SANS grille → tarif €/kg saisi pour CE client, sinon 0 (aucun).
 */
// ⚠️ Imports STATIQUES = modules PURS uniquement (relatifs, pour vitest) ; les
// dépendances I/O (prisma, stores) sont chargées dynamiquement DANS
// loadDocTransportContext — docTransportCost reste testable sans base.
import {
  computeTransportMetrics,
  isDirectCarrier,
  normCarrier,
  sanitizeClientPricing,
  type ClientCarrierPricing,
  type TransportCostModel,
} from "./transportCost";
import { computePositionCost, resolveCarrierTariff, type CarrierTariffMap } from "./carrierTariff";
import { departementOfZip } from "./geo/zip";
import type { ClientTournee } from "./clientTournee";
import type { ClientSegment } from "./segments";

export type DocTransportMode = "direct" | "grille" | "perkg" | "aucun";

/* ── RÈGLE TEMPORAIRE (direction, 07/2026) ─────────────────────────
 * « Pars du principe que les MAGASINS d'Île-de-France sont livrés en DIRECT
 * tout le temps » : pour un client GMS/CHR dont le département est en IDF, le
 * coût est TOUJOURS celui d'une position de la flotte propre — quel que soit
 * le transporteur porté par le document (Fargier assure la fin de parcours du
 * réseau Delanchy en IDF sans grille dédiée). Les segments non livrés
 * (RUNGIS / MIN / EXPORT / comptoir) ne sont PAS concernés.
 * Pour retirer la règle : vider IDF_DIRECT_DEPTS. */
const IDF_DIRECT_DEPTS = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
const IDF_DIRECT_SEGMENTS = new Set<ClientSegment>(["GMS", "CHR"]);

export interface DocTransportContext {
  model: TransportCostModel;
  /** Direct : coût PAR POSITION (annuel ÷ livraisons) — 0 si non paramétré. */
  costPerDelivery: number;
  /** Référence €/kg de la flotte propre (repli si costPerDelivery absent). */
  prixPositionPerKg: number;
  tariffs: CarrierTariffMap;
  /** Tournée habituelle par CARDCODE (MAJUSCULES). */
  tournees: Map<string, ClientTournee>;
  /** Tarifs €/kg legacy par id de client TeleVent. */
  pricingById: Map<string, ClientCarrierPricing>;
}

/** Charge tout le contexte nécessaire au coût par document (1 fois par requête). */
export async function loadDocTransportContext(cardCodes: string[]): Promise<DocTransportContext> {
  const [{ getTransportModel, listCarrierTariffs }, { getClientTournees }, { prisma }] = await Promise.all([
    import("./transportCostStore"),
    import("./clientTournee"),
    import("./prisma"),
  ]);
  const [model, tariffs, tournees] = await Promise.all([
    getTransportModel(),
    listCarrierTariffs(),
    getClientTournees([...new Set(cardCodes)]),
  ]);
  const metrics = computeTransportMetrics(model);
  const pricingById = new Map<string, ClientCarrierPricing>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "transportcli:" } } });
    for (const row of rows) {
      try { pricingById.set(row.key.slice("transportcli:".length), sanitizeClientPricing(JSON.parse(row.value))); } catch { /* ignore */ }
    }
  } catch { /* pas de tarifs legacy */ }
  return {
    model,
    costPerDelivery: metrics.costPerDelivery,
    prixPositionPerKg: metrics.prixPositionPerKg,
    tariffs,
    tournees,
    pricingById,
  };
}

export interface DocTransportResult {
  cost: number;
  /** Transporteur retenu (MAJUSCULES) — null si introuvable. */
  carrier: string | null;
  mode: DocTransportMode;
  /** true si le transporteur vient du DOCUMENT (réel), false = tournée habituelle. */
  fromDoc: boolean;
}

/** Coût de transport d'UN document (position). `kg ≤ 0` = pas de marchandise
 *  livrée (facture de service/refacturation) → 0, quel que soit le transporteur.
 *  `segment` (groupe SAP du client) active la règle « magasin IDF = direct ». */
export function docTransportCost(
  ctx: DocTransportContext,
  doc: {
    cardCode: string; clientId?: string | null; zip?: string | null; kg: number;
    trspCode?: string | null; segment?: ClientSegment | null;
  },
): DocTransportResult {
  const kg = Number.isFinite(doc.kg) ? doc.kg : 0;
  if (kg <= 0) return { cost: 0, carrier: null, mode: "aucun", fromDoc: false };

  const docCode = normCarrier(doc.trspCode);
  const tourCode = normCarrier(ctx.tournees.get(doc.cardCode.trim().toUpperCase())?.trspCode);
  const code = docCode || tourCode;
  const fromDoc = !!docCode;

  // Règle « MAGASIN IDF = DIRECT tout le temps » — prioritaire sur le
  // transporteur du document (cf. bloc IDF_DIRECT_DEPTS ci-dessus).
  const dept = departementOfZip(doc.zip);
  if (dept && IDF_DIRECT_DEPTS.has(dept) && doc.segment && IDF_DIRECT_SEGMENTS.has(doc.segment)) {
    const cost = ctx.costPerDelivery > 0 ? ctx.costPerDelivery : ctx.prixPositionPerKg * kg;
    return { cost, carrier: code || "DIRECT", mode: "direct", fromDoc: true };
  }

  if (!code) return { cost: 0, carrier: null, mode: "aucun", fromDoc: false };

  // Flotte propre → coût PAR POSITION (repli €/kg si nb livraisons non saisi).
  if (isDirectCarrier(ctx.model, code) || ctx.model.directCarriers.length === 0) {
    const cost = ctx.costPerDelivery > 0 ? ctx.costPerDelivery : ctx.prixPositionPerKg * kg;
    return { cost, carrier: code, mode: "direct", fromDoc };
  }

  // Externe : grille par position (département × tranche de poids).
  const pos = computePositionCost(resolveCarrierTariff(ctx.tariffs, code), departementOfZip(doc.zip), kg);
  if (pos) return { cost: pos.total, carrier: code, mode: "grille", fromDoc };

  // Repli : tarif €/kg saisi pour ce client et ce transporteur.
  const perKg = doc.clientId ? ctx.pricingById.get(doc.clientId)?.[code] : undefined;
  if (perKg && perKg > 0) return { cost: perKg * kg, carrier: code, mode: "perkg", fromDoc };

  // Transporteur connu mais AUCUN tarif applicable → 0 signalé (à paramétrer).
  return { cost: 0, carrier: code, mode: "aucun", fromDoc };
}

/* ── Règle CADEAUX (prime commerciale) ─────────────────────────────
 * Un cadeau = ligne PRODUIT offerte : quantité > 0 et total ligne ≈ 0 €
 * (article à 0 € ou remise 100 %). Sa marge SAP ligne vaut −coût : on la
 * NEUTRALISE dans la base de prime (le geste commercial ne mange pas la prime).
 * Fragment SQL partagé (alias `l` = ligne de facture). */
export const GIFT_LINE_SQL =
  `l."itemCode" IS NOT NULL AND l."quantity" > 0 AND l."lineTotal" BETWEEN -0.005 AND 0.005`;
