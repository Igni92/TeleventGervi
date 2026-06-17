import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * Migration ESLint flat config (ESLint 9 / Next 16).
 * Equivalent de l'ancien `.eslintrc.json` : { "extends": ["next/core-web-vitals"] }.
 * `next lint` ayant ete retire en Next 16, on utilise l'ESLint CLI directement (`eslint .`).
 *
 * IMPORTANT (parite avec Next 14) :
 * Next 16 embarque `eslint-plugin-react-hooks` v6 qui active par defaut une suite de
 * regles "React Compiler" (immutability, purity, set-state-in-effect, refs, etc.) en `error`.
 * Ces regles n'existaient PAS sous Next 14 (`eslint-plugin-react-hooks` v4 ne fournissait que
 * `rules-of-hooks` + `exhaustive-deps`). Comme cette migration doit conserver un comportement
 * fonctionnel IDENTIQUE (pas de refonte des effets), on retablit le niveau de regles react-hooks
 * tel qu'il etait sous Next 14 : `rules-of-hooks` en error, `exhaustive-deps` en warn, et on
 * desactive les nouvelles regles v6. A reactiver lors d'un futur chantier dedie React Compiler.
 */
const config = [
  {
    // `.claude/**` : worktrees git d'autres branches (artefacts d'environnement, hors projet).
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".claude/**"],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // Conserve sous Next 14
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Nouvelles regles react-hooks v6 (Next 16) — desactivees pour parite Next 14
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/void-use-memo": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/config": "off",
      "react-hooks/gating": "off",
    },
  },
];

export default config;
