import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    // lib/ héberge des classes utilitaires partagées (ex. SEGMENT_BADGE de
    // lib/segments.ts) : sans ce glob, le JIT ne génère pas ces classes.
    "./lib/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      // Palier « petit téléphone » (≈ 380 px) — INTERCALÉ sous `sm` (640 px).
      // Cible les iPhone en « Affichage zoomé » / gros texte, où le viewport
      // effectif tombe vers 320-375 px : la base (< xs) reste la plus sobre,
      // `xs:` réintroduit l'info secondaire dès qu'on a un peu de largeur.
      screens: {
        xs: "380px",
      },
      // Pile SYSTÈME partout (SF sur Apple, sinon Inter auto-hébergée puis
      // Segoe/Roboto). Space Grotesk est RETIRÉE : `display` = MÊME pile — la
      // classe .font-display garde son sens (graisse 700 + interlettrage
      // resserré, cf. globals.css), seule la famille change.
      fontFamily: {
        sans:    ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "var(--font-inter)", "Segoe UI", "Roboto", "system-ui", "sans-serif"],
        display: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "var(--font-inter)", "Segoe UI", "Roboto", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
      },
      // Rampe typographique nommée (la SEULE autorisée pour le nouveau code ;
      // les tailles Tailwind par défaut restent dispo pour l'existant).
      // Plus c'est gros, plus l'interlettrage se resserre — c'est la rampe iOS.
      fontSize: {
        caption2: ["11px", { lineHeight: "14px" }],
        caption:  ["12px", { lineHeight: "16px" }],
        body:     ["13px", { lineHeight: "19px", letterSpacing: "-0.01em" }],
        callout:  ["15px", { lineHeight: "22px", letterSpacing: "-0.01em" }],
        title3:   ["17px", { lineHeight: "23px", letterSpacing: "-0.018em" }],
        title2:   ["22px", { lineHeight: "28px", letterSpacing: "-0.022em" }],
        title1:   ["28px", { lineHeight: "32px", letterSpacing: "-0.026em" }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Statuts sémantiques (cf. globals.css) — `text-success`, `bg-warning/12`,
        // `ring-info/25`… basculent automatiquement clair/sombre.
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        info:    "hsl(var(--info) / <alpha-value>)",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Brand — pilotée par CSS vars (triplets HSL) pour permettre de basculer
        // la COLORIMÉTRIE à chaud via [data-theme] (Or / Agrume / Fraise…).
        // Valeurs par défaut (Or/jaune) définies dans globals.css :root.
        brand: {
          50:  "hsl(var(--brand-50) / <alpha-value>)",
          100: "hsl(var(--brand-100) / <alpha-value>)",
          200: "hsl(var(--brand-200) / <alpha-value>)",
          300: "hsl(var(--brand-300) / <alpha-value>)",
          400: "hsl(var(--brand-400) / <alpha-value>)",
          500: "hsl(var(--brand-500) / <alpha-value>)",
          600: "hsl(var(--brand-600) / <alpha-value>)",
          700: "hsl(var(--brand-700) / <alpha-value>)",
          800: "hsl(var(--brand-800) / <alpha-value>)",
          900: "hsl(var(--brand-900) / <alpha-value>)",
          950: "hsl(var(--brand-950) / <alpha-value>)",
        },
      },
      // RAYONS : 4 crans seulement (6/10/14/20 px, cf. --r-xs..lg de
      // globals.css). Les rounded-* existants du code se re-calent d'un coup
      // sur cette grille ; `sm` est aligné sur le cran xs pour ne laisser
      // aucun rayon hors échelle.
      borderRadius: {
        sm:    "6px",
        md:    "6px",
        lg:    "10px",
        xl:    "14px",
        "2xl": "20px",
        "3xl": "20px",
      },
      // Ombres = tokens (contour 0.5px + ombre NEUTRE, jamais teintée) —
      // définies dans globals.css, basculent seules clair/sombre.
      boxShadow: {
        card:         "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        nav:          "var(--shadow-nav)",
        modal:        "var(--shadow-modal)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          // `none` (≠ translateY(0)) : une fois l'animation finie (fill-mode
          // both), un transform résiduel créait un CONTEXTE D'EMPILEMENT
          // permanent sur chaque carte → les dropdowns (z-20) passaient SOUS
          // les cartes suivantes du DOM (ex. recherche recette de Fabrication
          // sous « Historique des fabrications »).
          to:   { opacity: "1", transform: "none" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to:   { opacity: "1", transform: "none" },
        },
        "slide-right": {
          from: { opacity: "0", transform: "translateX(-12px)" },
          to:   { opacity: "1", transform: "none" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to:   { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        // `backwards` (≠ both) : le fill « forwards » d'une animation de
        // transform maintient un CONTEXTE D'EMPILEMENT PERMANENT (même avec
        // `to { transform: none }`, le computed reste matrix identité — vérifié
        // Chromium) → les dropdowns z-20 passaient SOUS les cartes suivantes du
        // DOM (ex. recherche recette de Fabrication sous « Historique »).
        // L'état final de ces animations = les styles de base (opacity 1, pas
        // de transform) : une fois finies, plus aucun fill → rendu identique,
        // contexte d'empilement libéré. `backwards` garde le `from` pendant
        // l'animation-delay (cascades de cartes).
        "fade-up":    "fade-up 0.4s ease-out backwards",
        "fade-in":    "fade-in 0.3s ease-out backwards",
        "scale-in":   "scale-in 0.25s ease-out backwards",
        "slide-right":"slide-right 0.3s ease-out backwards",
        shimmer:      "shimmer 1.5s ease-in-out infinite",
      },
      transitionTimingFunction: {
        "spring": "cubic-bezier(0.175, 0.885, 0.32, 1.1)",
        "smooth": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // Variante `touch:` — active quand <html data-ui="touch"> (appareil tactile
    // détecté par le script anti-FOUC de app/layout.tsx : téléphone/tablette,
    // émulateurs compris). Sert à forcer la coquille MOBILE sur tablette.
    require("tailwindcss/plugin")(({ addVariant }: { addVariant: (n: string, d: string) => void }) => {
      addVariant("touch", '[data-ui="touch"] &');
    }),
  ],
};

export default config;
