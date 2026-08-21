/**
 * Couleurs et libellés canoniques des types de document (BL · Facture · Avoir).
 * VÉRITÉ UNIQUE partagée par l'explorateur, le kanban et le dossier lié — fin
 * du double TYPE_PILL / PILL divergents. Style pilule translucide du design
 * system (fond /12, texte 700 clair · 300 sombre, liseré /25), lisible sur les
 * deux thèmes. Classes COMPLÈTES : le JIT Tailwind ne génère que le littéral.
 */
export const DOC_TYPE_PILL: Record<string, string> = {
  BL: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/25",
  FACTURE: "bg-blue-500/12 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-500/25",
  AVOIR: "bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/25",
  AUTRE: "bg-secondary text-muted-foreground ring-1 ring-inset ring-border",
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  FACTURE: "Facture",
  BL: "BL",
  AVOIR: "Avoir",
  AUTRE: "Doc",
};

/** Ordre d'affichage stable des types (flux BL → Facture → Avoir → autre). */
export const DOC_TYPE_ORDER = ["BL", "FACTURE", "AVOIR", "AUTRE"];
