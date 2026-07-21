/**
 * PROSPECTION (CRM) — modèle de pipeline PARTAGÉ (serveur + client).
 *
 * Règles métier (juillet 2026, demande direction) :
 *   • CLIENT vs PROSPECT : un compte facturé il y a MOINS d'un an est un CLIENT ;
 *     sans commande depuis PLUS d'un an (ou jamais), c'est un PROSPECT. Un compte
 *     explicitement mis en pipeline (prospectStage) est un prospect tant qu'il
 *     n'est pas GAGNE.
 *   • PROPRIÉTÉ : un prospect travaillé par un commercial lui reste rattaché
 *     (Client.prospectOwner = son trigramme). À l'étape GAGNE (2e commande), il
 *     bascule dans son portefeuille clients.
 *   • Chaque étape porte un SCRIPT d'appel affiché au commercial (éditable côté
 *     app — ces textes sont les valeurs par défaut).
 *
 * Module volontairement PUR (aucun import serveur / prisma) — importable côté
 * serveur ET client, comme lib/transportCost / lib/carrierTariff.
 */

/* ─────────────────────────── Étapes du pipeline ─────────────────────────── */

export type StageKey =
  | "A_CONTACTER"
  | "QUALIFICATION"
  | "PRESENTATION"
  | "POST_COMMANDE"
  | "GAGNE"
  | "PERDU";

export interface Stage {
  key: StageKey;
  label: string;
  short: string;
  /** Ordre dans le pipeline (PERDU = hors flux, ordre 99). */
  order: number;
  /** Couleur d'accent (tailwind-ish hex) pour la colonne Kanban. */
  color: string;
  /** Le compte est-il encore un « prospect » à cette étape ? (GAGNE = non) */
  isProspect: boolean;
  /** Script d'appel / points clés affichés au commercial (valeur par défaut). */
  script: string;
}

export const STAGES: Stage[] = [
  {
    key: "A_CONTACTER",
    label: "À contacter",
    short: "À contacter",
    order: 0,
    color: "#64748b",
    isProspect: true,
    script:
      "OBJECTIF : passer le standard, joindre le responsable du LABO PÂTISSERIE " +
      "(ou chef de rayon boulangerie-pâtisserie).\n\n" +
      "« Bonjour, [Prénom] de Gervi, grossiste en fruits. Je souhaite parler au " +
      "responsable du labo pâtisserie s'il vous plaît. »\n\n" +
      "Accroche : « On est spécialisés dans les FRUITS POUR LA PÂTISSERIE (fruits " +
      "rouges, exotiques, fruits de découpe). On livre déjà des magasins à côté de " +
      "chez vous tous les matins. Vous travaillez les fruits frais en labo ? »\n\n" +
      "→ Si labo confirmé : cocher « qualifié labo » et passer en Qualification.",
  },
  {
    key: "QUALIFICATION",
    label: "Qualification",
    short: "Qualif.",
    order: 1,
    color: "#0ea5e9",
    isProspect: true,
    script:
      "OBJECTIF : confirmer le labo, comprendre volumes et produits.\n\n" +
      "« Vous transformez quoi — tartes, salades de fruits, verrines ? Quels fruits " +
      "reviennent le plus ? Vous êtes livré combien de fois par semaine, par qui ? »\n\n" +
      "Noter les volumes + le fournisseur actuel. Objection « j'ai déjà un fournisseur » " +
      "→ « Je ne veux pas vous faire changer, juste être votre dépannage frais en J+1. »\n\n" +
      "→ Si besoin réel : passer en Présentation.",
  },
  {
    key: "PRESENTATION",
    label: "Présentation + RDV",
    short: "Présentation",
    order: 2,
    color: "#8b5cf6",
    isProspect: true,
    script:
      "OBJECTIF : envoyer la GAMME PAR MAIL et caler un RENDEZ-VOUS (R1 physique).\n\n" +
      "« Je vous envoie notre gamme et la dispo du jour par mail. On passe se " +
      "présenter et vous faire goûter — quel matin vous arrange cette semaine ? »\n\n" +
      "→ Bouton « Envoyer la gamme » (mail) + créer le RENDEZ-VOUS (agenda, notif 1 h avant).\n" +
      "→ Après le R1 et une 1re commande : passer en Après 1re commande.",
  },
  {
    key: "POST_COMMANDE",
    label: "Après 1re commande",
    short: "Post-cde",
    order: 3,
    color: "#f59e0b",
    isProspect: true,
    script:
      "OBJECTIF : valider la 1re livraison et enclencher la récurrence.\n\n" +
      "« La livraison s'est bien passée ? La qualité vous convient ? On vous rappelle " +
      "chaque matin avec la dispo — quel jour vous arrange le mieux ? »\n\n" +
      "→ Dès la 2e commande : passer en Client gagné.",
  },
  {
    key: "GAGNE",
    label: "Client gagné",
    short: "Gagné",
    order: 4,
    color: "#22c55e",
    isProspect: false,
    script:
      "« Parfait, on vous met dans notre tournée, on vous appelle tous les matins. »\n\n" +
      "→ Le compte bascule dans le PORTEFEUILLE CLIENTS du commercial (prospectOwner), " +
      "avec un jour d'appel. Fin du pipeline de prospection.",
  },
  {
    key: "PERDU",
    label: "Perdu",
    short: "Perdu",
    order: 99,
    color: "#ef4444",
    isProspect: true,
    script:
      "Renseigner le MOTIF (déjà sous contrat / pas de labo / prix / injoignable).\n\n" +
      "Relance différée : « Je vous rappelle dans 2-3 mois avec nos nouveautés de saison, " +
      "ça marche ? » → planifier un rappel.",
  },
];

export const STAGE_KEYS: StageKey[] = STAGES.map((s) => s.key);
const STAGE_BY_KEY: Record<string, Stage> = Object.fromEntries(STAGES.map((s) => [s.key, s]));

/** Colonnes du Kanban dans l'ordre du flux (PERDU exclu — vue à part). */
export const PIPELINE_STAGES: Stage[] = STAGES.filter((s) => s.key !== "PERDU").sort((a, b) => a.order - b.order);

export function getStage(key: string | null | undefined): Stage | null {
  return key ? STAGE_BY_KEY[key] ?? null : null;
}
export function stageLabel(key: string | null | undefined): string {
  return getStage(key)?.label ?? "—";
}
export function isValidStage(key: string | null | undefined): key is StageKey {
  return !!key && key in STAGE_BY_KEY;
}
/** Étape suivante dans le flux (null si GAGNE/PERDU ou inconnue). */
export function nextStage(key: string | null | undefined): StageKey | null {
  const s = getStage(key);
  if (!s || s.key === "GAGNE" || s.key === "PERDU") return null;
  const next = PIPELINE_STAGES.find((x) => x.order === s.order + 1);
  return next?.key ?? null;
}

/* ───────────────────── Séparation CLIENT / PROSPECT ─────────────────────── */

/** Un compte sans commande depuis PLUS de N jours (re)devient prospect. */
export const PROSPECT_INACTIVITY_DAYS = 365;

export type AccountKind = "CLIENT" | "PROSPECT";

/**
 * Classe un compte en CLIENT ou PROSPECT.
 *   • prospectStage renseigné et ≠ GAGNE  → PROSPECT (en cours de travail) ;
 *   • sinon, commande < 1 an               → CLIENT ;
 *   • sinon (aucune commande, ou > 1 an)   → PROSPECT.
 * `now` injectable pour les tests (défaut : maintenant).
 */
export function classifyAccount(
  lastOrderAt: Date | string | null | undefined,
  prospectStage: string | null | undefined,
  now: Date = new Date(),
): AccountKind {
  if (prospectStage && prospectStage !== "GAGNE") return "PROSPECT";
  const last = lastOrderAt ? new Date(lastOrderAt) : null;
  if (!last || Number.isNaN(last.getTime())) return "PROSPECT";
  const days = (now.getTime() - last.getTime()) / 86_400_000;
  return days <= PROSPECT_INACTIVITY_DAYS ? "CLIENT" : "PROSPECT";
}

export function isProspect(
  lastOrderAt: Date | string | null | undefined,
  prospectStage: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return classifyAccount(lastOrderAt, prospectStage, now) === "PROSPECT";
}

/**
 * Variante à partir du NOMBRE DE JOURS depuis la dernière commande (déjà calculé
 * côté liste `/plan-appel`, évite de reconstruire une date). `null` = jamais
 * commandé → PROSPECT.
 */
export function classifyByDays(
  lastOrderDays: number | null | undefined,
  prospectStage: string | null | undefined,
): AccountKind {
  if (prospectStage && prospectStage !== "GAGNE") return "PROSPECT";
  if (lastOrderDays == null) return "PROSPECT";
  return lastOrderDays <= PROSPECT_INACTIVITY_DAYS ? "CLIENT" : "PROSPECT";
}

/* ─────────────────────────── Rendez-vous / RDV ──────────────────────────── */

export type RdvType = "R1_PHYSIQUE" | "APPEL" | "AUTRE";
export const RDV_TYPES: { key: RdvType; label: string }[] = [
  { key: "R1_PHYSIQUE", label: "R1 physique" },
  { key: "APPEL", label: "Appel programmé" },
  { key: "AUTRE", label: "Autre" },
];

/** Délai de notification par défaut avant un RDV (minutes) — modifiable par RDV. */
export const DEFAULT_NOTIFY_MINUTES_BEFORE = 60;
/** Choix rapides proposés dans l'UI pour le délai de notification. */
export const NOTIFY_MINUTES_CHOICES = [15, 30, 60, 120, 1440];

export function notifyLabel(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} j avant`;
  if (min % 60 === 0) return `${min / 60} h avant`;
  return `${min} min avant`;
}

/* ─────────────────────────── Motifs de perte ────────────────────────────── */

export const LOST_REASONS = [
  "Déjà sous contrat",
  "Pas de labo pâtisserie",
  "Prix",
  "Injoignable",
  "Pas intéressé",
  "Autre",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

/* ─────────────────────────── Proba de labo ──────────────────────────────── */

export const PROBA_LABO = ["Élevée", "Moyenne-haute", "Moyenne", "À qualifier"] as const;
export type ProbaLabo = (typeof PROBA_LABO)[number];

export const ACTIVITY_KINDS = ["APPEL", "MAIL", "RDV", "NOTE", "STAGE"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
