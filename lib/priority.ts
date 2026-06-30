/**
 * Priorisation d'appel — score « valeur × urgence ».
 *
 * Fonction PURE et déterministe. Elle fusionne trois signaux déjà disponibles
 * dans l'app (aucune nouvelle donnée à collecter — cf. audit 07, item #43) :
 *   1. l'URGENCE, dérivée du cycle de vie relatif à la cadence du client
 *      (`lib/lifecycle.ts`) — un CHR quotidien est « en retard » bien plus vite
 *      qu'un export mensuel ;
 *   2. la VALEUR, le palier A/B/C/D issu du CA 12 mois (`lib/clientValue.ts`) ;
 *   3. un léger boost si des incidents sont ouverts (à traiter en priorité).
 *
 * Le résultat est un `score` triable (plus haut = plus prioritaire) plus une
 * `reason` courte en français — la « prochaine action » à afficher dans la file.
 *
 * Pourquoi ce score remplace le tri cosmétique côté client (heure/nom) :
 * la file calendaire actuelle noie les gros comptes en retard. Le tri devient
 * SERVEUR, par enjeu réel, et reste relatif à la cadence propre de chaque
 * client (un retard de 5 j n'a pas le même sens pour tout le monde).
 */

import { deriveLifecycle, type LifecycleResult, type LifecycleState } from "./lifecycle";
import { valueTier, type ValueTier, type ValueTierKey } from "./clientValue";

export interface PriorityInput {
  /** Jours depuis la dernière commande. `null` = jamais commandé. */
  lastOrderDays: number | null;
  /** Cadence médiane (jours entre commandes). `null` si historique insuffisant. */
  medianIntervalDays: number | null;
  /** Tendance 30j vs 30j précédents. */
  trend30?: "rising" | "stable" | "falling" | null;
  /** Variation année sur année en % (ex. -45). Optionnel. */
  yoyPct?: number | null;
  /** CA 12 mois glissants (€ HT). `null`/0 → palier D. */
  ca12m?: number | null;
  /** Nombre d'incidents ouverts — léger boost de priorité. */
  openIncidents?: number;
}

export interface PriorityResult {
  /** Score triable : plus haut = plus prioritaire. */
  score: number;
  lifecycle: LifecycleResult;
  tier: ValueTier;
  /** Retard relatif à la cadence (lastOrderDays / medianIntervalDays), borné. `null` si non calculable. */
  overdueRatio: number | null;
  /** Phrase courte « prochaine action », prête à afficher. */
  reason: string;
}

/**
 * Urgence de base par état du cycle de vie, pensée pour une FILE D'APPEL DU JOUR.
 * Les états « qui glissent mais récupérables » priment : un client à risque ou
 * juste en retard a le meilleur ROI d'appel. Endormi/Perdu = reconquête (utile
 * mais moins urgent qu'un client encore actif qui décroche). Actif = on l'appelle
 * dans sa cadence (il est dans la file parce que c'est son jour), pas en urgence.
 */
const STATE_URGENCY: Record<LifecycleState, number> = {
  A_RISQUE: 80,
  EN_RETARD: 65,
  ENDORMI: 50,
  NOUVEAU: 45,
  ACTIF: 30,
  PERDU: 25,
};

/**
 * Multiplicateur de valeur : un gros compte passe devant un petit à urgence
 * égale. Volontairement modéré (×1.6 max) pour que l'urgence reste le moteur
 * principal — on ne veut pas qu'un compte clé « actif » passe devant un petit
 * compte « à risque » par sa seule taille.
 */
const TIER_WEIGHT: Record<ValueTierKey, number> = {
  A: 1.6,
  B: 1.3,
  C: 1.1,
  D: 1.0,
};

/** Borne haute du ratio de retard prise en compte (au-delà, le signal sature). */
const OVERDUE_RATIO_CAP = 4;

/** Construit la phrase « prochaine action » selon l'état et les jours de retard. */
function buildReason(
  lifecycle: LifecycleResult,
  lastOrderDays: number | null,
  medianIntervalDays: number | null,
): string {
  const d = lastOrderDays;
  const m = medianIntervalDays;
  const cadence = m != null && Number.isFinite(m) && m > 0 ? ` (cadence ~${m} j)` : "";
  switch (lifecycle.state) {
    case "A_RISQUE":
      return d != null ? `À risque — ${d} j sans commande${cadence}` : "À risque — à recontacter";
    case "EN_RETARD":
      return d != null ? `En retard — ${d} j sans commande${cadence}` : "En retard sur sa cadence";
    case "ENDORMI":
      return d != null ? `Endormi — ${d} j sans commande, à réveiller` : "Endormi — à réveiller";
    case "PERDU":
      return d != null ? `Perdu — ${d} j sans commande, reconquête` : "Perdu — reconquête";
    case "NOUVEAU":
      return "Nouveau client — à fidéliser";
    case "ACTIF":
    default:
      return "Dans sa cadence habituelle";
  }
}

/**
 * Calcule la priorité d'appel d'un client à partir de ses signaux.
 *
 * Robuste aux données manquantes : un client sans historique retombe sur
 * « Nouveau » (urgence moyenne) et palier D ; le ratio de retard n'est ajouté
 * que lorsqu'il est calculable.
 */
export function computePriority(input: PriorityInput): PriorityResult {
  const {
    lastOrderDays,
    medianIntervalDays,
    trend30 = null,
    yoyPct = null,
    ca12m = null,
    openIncidents = 0,
  } = input;

  const lifecycle = deriveLifecycle({ lastOrderDays, medianIntervalDays, trend30, yoyPct });
  const tier = valueTier(ca12m ?? 0);

  // Ratio de retard relatif à la cadence (borné), null si non calculable.
  let overdueRatio: number | null = null;
  if (
    lastOrderDays != null &&
    Number.isFinite(lastOrderDays) &&
    medianIntervalDays != null &&
    Number.isFinite(medianIntervalDays) &&
    medianIntervalDays > 0
  ) {
    overdueRatio = Math.min(lastOrderDays / medianIntervalDays, OVERDUE_RATIO_CAP);
  }

  // Urgence = base de l'état + bonus de retard relatif + boost incidents.
  const base = STATE_URGENCY[lifecycle.state];
  const overdueBonus = overdueRatio != null ? Math.max(0, overdueRatio - 1) * 6 : 0;
  const incidentBoost = Math.min(Math.max(openIncidents, 0), 3) * 4;
  const urgency = base + overdueBonus + incidentBoost;

  // Valeur = multiplicateur de palier.
  const score = Math.round(urgency * TIER_WEIGHT[tier.tier] * 10) / 10;

  return {
    score,
    lifecycle,
    tier,
    overdueRatio,
    reason: buildReason(lifecycle, lastOrderDays, medianIntervalDays),
  };
}
