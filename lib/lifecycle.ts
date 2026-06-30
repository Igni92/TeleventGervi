/**
 * Cycle de vie client — dérivation PURE et RÉVERSIBLE à la lecture.
 *
 * Aucun champ n'est stocké en base : l'état est recalculé à chaque affichage à
 * partir des signaux comportementaux déjà produits par `lib/insights.ts`
 * (récence, cadence médiane, tendance 30j) + éventuellement le YoY.
 *
 * Le cœur de la règle est RELATIF à la cadence propre du client : un client qui
 * commande toutes les semaines est « en retard » bien plus vite qu'un client qui
 * commande tous les deux mois. On compare donc `lastOrderDays` à des multiples de
 * `medianIntervalDays` plutôt qu'à des seuils absolus.
 *
 * Garde-fou : « Perdu » est borné en absolu (> 90 j ou jamais de commande), pour
 * éviter qu'un gros client à cadence très lente passe « actif » après 4 mois.
 */

export type LifecycleState =
  | "ACTIF"
  | "EN_RETARD"
  | "A_RISQUE"
  | "ENDORMI"
  | "PERDU"
  | "NOUVEAU";

/** Couleur sémantique — sert à mapper vers le Badge/les tokens côté présentation. */
export type LifecycleTone = "positive" | "neutral" | "warning" | "danger" | "info";

export interface LifecycleResult {
  state: LifecycleState;
  /** Libellé court en français, prêt à afficher. */
  label: string;
  tone: LifecycleTone;
}

export interface LifecycleInput {
  /** Jours écoulés depuis la dernière commande. `null` = jamais commandé. */
  lastOrderDays: number | null;
  /** Cadence médiane (jours entre commandes). `null` si historique insuffisant. */
  medianIntervalDays: number | null;
  /** Tendance des 30 derniers jours vs les 30 précédents. */
  trend30?: "rising" | "stable" | "falling" | null;
  /** Variation année sur année en % (ex. -45 pour -45 %). Optionnel. */
  yoyPct?: number | null;
}

/** Au-delà de ce nombre de jours sans commande, le client est considéré perdu. */
export const PERDU_THRESHOLD_DAYS = 90;
/** En-deçà de cette chute YoY (en %), on bascule en « à risque ». Ajustable. */
export const YOY_RISK_THRESHOLD_PCT = -40;

const LABELS: Record<LifecycleState, string> = {
  ACTIF: "Actif",
  EN_RETARD: "En retard",
  A_RISQUE: "À risque",
  ENDORMI: "Endormi",
  PERDU: "Perdu",
  NOUVEAU: "Nouveau",
};

const TONES: Record<LifecycleState, LifecycleTone> = {
  ACTIF: "positive",
  EN_RETARD: "warning",
  A_RISQUE: "warning",
  ENDORMI: "neutral",
  PERDU: "danger",
  NOUVEAU: "info",
};

function build(state: LifecycleState): LifecycleResult {
  return { state, label: LABELS[state], tone: TONES[state] };
}

/**
 * Dérive l'état du cycle de vie à partir des signaux comportementaux.
 *
 * Robuste aux valeurs manquantes :
 *  - pas de `lastOrderDays` → NOUVEAU (aucun historique de commande) ;
 *  - pas de `medianIntervalDays` (1 seule commande) → on retombe sur les seuils
 *    absolus (perdu si > 90 j, sinon actif).
 *
 * Ordre d'évaluation (du plus grave au plus sain) pour que les cas extrêmes
 * priment sur les cas relatifs.
 */
export function deriveLifecycle(input: LifecycleInput): LifecycleResult {
  const { lastOrderDays, medianIntervalDays, trend30, yoyPct } = input;

  // ── Nouveau : aucune commande connue ───────────────────────────────────────
  if (lastOrderDays == null || !Number.isFinite(lastOrderDays)) {
    return build("NOUVEAU");
  }

  // ── Perdu : garde-fou absolu (> 90 j) ──────────────────────────────────────
  if (lastOrderDays > PERDU_THRESHOLD_DAYS) {
    return build("PERDU");
  }

  const yoyVeryNegative =
    yoyPct != null && Number.isFinite(yoyPct) && yoyPct <= YOY_RISK_THRESHOLD_PCT;

  // ── Cadence inconnue (1 seule commande) : seuils absolus ───────────────────
  if (
    medianIntervalDays == null ||
    !Number.isFinite(medianIntervalDays) ||
    medianIntervalDays <= 0
  ) {
    // À risque si signaux baissiers, sinon actif (commande récente, < 90 j).
    if (trend30 === "falling" || yoyVeryNegative) return build("A_RISQUE");
    return build("ACTIF");
  }

  // ── Règles RELATIVES à la cadence du client ────────────────────────────────
  // Endormi : très en retard sur sa propre cadence (> 3× médiane).
  if (lastOrderDays > 3 * medianIntervalDays) {
    return build("ENDORMI");
  }
  // À risque : au-delà de 2× la médiane, ou signaux baissiers nets.
  if (lastOrderDays > 2 * medianIntervalDays || trend30 === "falling" || yoyVeryNegative) {
    return build("A_RISQUE");
  }
  // En retard : a dépassé sa cadence habituelle mais reste dans le 2× médiane.
  if (lastOrderDays > medianIntervalDays) {
    return build("EN_RETARD");
  }
  // Actif : commande dans sa fenêtre de cadence habituelle.
  return build("ACTIF");
}
