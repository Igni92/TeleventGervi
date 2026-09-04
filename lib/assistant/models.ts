/**
 * Modèles IA disponibles pour l'assistant. Le gérant peut choisir lequel utiliser
 * dès qu'une clé API est configurée (ANTHROPIC_API_KEY côté serveur).
 *
 * Pour ajouter un modèle : une ligne ici suffit. Le sélecteur de la bulle de chat
 * et la validation serveur lisent tous deux cette liste (source de vérité unique).
 */
export type AssistantModel = {
  id: string;
  label: string;
  /** Repère de coût/vitesse affiché dans le sélecteur. */
  tier: "éclair" | "équilibré" | "expert";
  /** Court descriptif (coût indicatif) pour l'aide au choix. */
  note: string;
};

export const ASSISTANT_MODELS: AssistantModel[] = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", tier: "éclair", note: "Le plus rapide et le moins cher — idéal pour l'aide au quotidien." },
  { id: "claude-sonnet-5", label: "Sonnet 5", tier: "équilibré", note: "Plus fin, très bon rapport qualité/prix pour les questions complexes." },
  { id: "claude-opus-4-8", label: "Opus 4.8", tier: "expert", note: "Le plus capable — pour les analyses les plus poussées (plus coûteux)." },
];

/** Modèle par défaut (léger) — surchargé par ASSISTANT_MODEL en env si présent. */
export const DEFAULT_ASSISTANT_MODEL = "claude-haiku-4-5";

export function isValidAssistantModel(id: unknown): id is string {
  return typeof id === "string" && ASSISTANT_MODELS.some((m) => m.id === id);
}

export function resolveAssistantModel(requested: unknown): string {
  if (isValidAssistantModel(requested)) return requested;
  const envDefault = process.env.ASSISTANT_MODEL;
  if (isValidAssistantModel(envDefault)) return envDefault;
  return DEFAULT_ASSISTANT_MODEL;
}
