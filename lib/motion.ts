/**
 * Motion design tokens — source unique de vérité pour les animations Framer Motion.
 *
 * Philosophie (cf. emil-design-eng + ui-ux-pro-max §7) :
 *   - Le mouvement exprime une cause→effet, jamais décoratif.
 *   - Durées courtes : micro-interactions 150–260 ms, transitions ≤ 360 ms.
 *   - Entrée ease-out, sortie plus rapide (~70 %).
 *   - Spring physique pour ce qui doit "vivre" (chiffres, panneaux), tween pour le reste.
 *   - TOUT respecte prefers-reduced-motion (cf. useReducedMotion de framer-motion).
 *
 * On centralise ici pour garantir un rythme cohérent dans toute l'app
 * (anti-pattern: durées/easings ad-hoc dispersés).
 */
import type { Transition, Variants } from "framer-motion";

/* ── Durées (s) ─────────────────────────────────────────── */
export const DUR = {
  fast: 0.16,
  base: 0.24,
  slow: 0.34,
  /** sortie = ~70 % de l'entrée pour un ressenti réactif */
  exit: 0.16,
} as const;

/* ── Easings (tuples bézier typés pour Framer Motion) ───── */
type Bezier = [number, number, number, number];
export const EASE = {
  /** ease-out doux — entrées d'éléments */
  out: [0.22, 1, 0.36, 1] as Bezier,
  /** ease-in — sorties */
  in: [0.4, 0, 1, 1] as Bezier,
  /** standard — transitions d'état */
  standard: [0.4, 0, 0.2, 1] as Bezier,
} as const;

/* ── Springs ────────────────────────────────────────────── */
export const SPRING = {
  /** réactif, peu de rebond — panneaux, cartes */
  snappy: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as Transition,
  /** doux — chiffres, valeurs */
  soft: { type: "spring", stiffness: 180, damping: 26 } as Transition,
  /** pour le press feedback */
  press: { type: "spring", stiffness: 600, damping: 30 } as Transition,
} as const;

/* ── Transitions tween prêtes à l'emploi ────────────────── */
export const tween = (d: number = DUR.base, ease: Bezier = EASE.out): Transition => ({
  duration: d,
  ease,
});

/* ═══════════════════════════════════════════════════════════
   VARIANTS réutilisables
   ─────────────────────────────────────────────────────────── */

/** Apparition vers le haut — la brique de base des entrées. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: tween() },
  exit: { opacity: 0, y: 6, transition: tween(DUR.exit, EASE.in) },
};

/** Apparition simple. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: tween() },
  exit: { opacity: 0, transition: tween(DUR.exit, EASE.in) },
};

/** Échelle + fondu — modales, popovers, confirmations. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: SPRING.snappy },
  exit: { opacity: 0, scale: 0.97, transition: tween(DUR.exit, EASE.in) },
};

/** Glissement latéral — navigation, swaps. */
export const slideRight: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: tween() },
  exit: { opacity: 0, x: 12, transition: tween(DUR.exit, EASE.in) },
};

/**
 * Conteneur à cascade — anime ses enfants (variant "show") en séquence.
 * Utiliser avec `staggerItem` sur chaque enfant.
 * stagger 36 ms (recommandation MD : 30–50 ms/élément).
 */
export const staggerContainer = (stagger = 0.036, delayChildren = 0.02): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren },
  },
});

/** Enfant d'un staggerContainer. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: tween(DUR.base) },
};

/* ── Press feedback (scale subtil 0.97) ─────────────────── */
export const pressable = {
  whileTap: { scale: 0.97 },
  transition: SPRING.press,
} as const;

/**
 * Helpers reduced-motion : à combiner avec `useReducedMotion()` de framer-motion.
 * Quand l'utilisateur a demandé moins d'animations, on coupe les déplacements
 * et on garde un simple fondu instantané (la donnée reste lisible immédiatement).
 */
export const reducedFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};
