/**
 * Thème graphique partagé — couleurs alignées sur les tokens de l'app.
 *
 * On expose des couleurs sémantiques (brand/positive/negative/neutral) sous forme
 * de chaînes CSS. Les composants charts les utilisent en `stroke`/`fill`.
 * Les couleurs « brand » suivent la signature jaune/or de TeleVent ; les séries
 * neutres utilisent des gris qui marchent en dark comme en light.
 *
 * Astuce dark-mode : pour la série principale on privilégie `currentColor`
 * (piloté par une classe Tailwind text-*) afin que le graphe s'adapte au thème.
 */
export const CHART = {
  // ⚠️ Valeurs concrètes (pas de var CSS) : SVG n'évalue pas var() dans les
  // attributs stroke/fill/stop-color. Les graphes gardent donc un accent fixe ;
  // l'UI (cartes/boutons/textes) suit la colorimétrie via l'échelle Tailwind brand.
  brand: "#facc15",
  brandSoft: "#d4a004",
  positive: "#10b981",    // emerald-500
  negative: "#f43f5e",    // rose-500
  info: "#38bdf8",        // sky-400
  violet: "#a78bfa",      // violet-400
  /** grille discrète (cf. gridline-subtle) — faible contraste */
  grid: "rgba(148,163,184,0.16)",
  axis: "rgba(148,163,184,0.55)",
} as const;

/**
 * Palette catégorielle — les 5 PREMIÈRES couleurs sont volontairement
 * espacées en teinte (proche Okabe-Ito) pour rester distinguables en
 * deutéranopie/protanopie. On garde le jaune brand en tête (signature),
 * puis on alterne bleu/vert/violet/orange avant les teintes plus proches.
 * Toujours accompagné de labels (la couleur n'est jamais le seul canal).
 */
export const CATEGORICAL = [
  "#facc15", // jaune (brand)
  "#38bdf8", // sky
  "#10b981", // emerald
  "#a78bfa", // violet
  "#fb923c", // orange
  "#f43f5e", // rose
  "#2dd4bf", // teal
  "#c084fc", // purple
] as const;

export type ChartTone = "brand" | "positive" | "negative" | "info" | "violet";

export const toneColor = (t: ChartTone): string => CHART[t];
