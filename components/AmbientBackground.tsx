import { AmbientMotionGate } from "@/components/settings/AmbientMotionGate";

/**
 * Fond ambiant global — DA « salle de signal ».
 *
 * Couche fixe DERRIÈRE tout le contenu (-z-10, pointer-events none) :
 *   - aurora teintée par l'accent (suit la colorimétrie via --brand-*)
 *   - grille technique masquée (feel télémétrie)
 *   - anneaux « radar » concentriques (écho au logo waveform/signal)
 *
 * Les cartes/panneaux étant opaques (bg-card), les données restent parfaitement
 * lisibles ; l'ambiance ne transparaît que dans les marges et gouttières.
 * Server component (aucun hook) — le CSS gère dérive + reduced-motion.
 *
 * Le réglage televente:animations (page /parametres) est honoré par le petit
 * client `AmbientMotionGate` : il pose `data-reduce-anim="1"` sur <html> quand
 * l'utilisateur coupe les animations, ce que globals.css traduit en `animation:
 * none` sur les couches d'ambiance (même effet que prefers-reduced-motion).
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <AmbientMotionGate />
      <div className="ambient-aurora" />
      <div className="ambient-aurora-2" />
      <div className="ambient-grid" />

      {/* Anneaux radar — haut-droite (balayage lent) */}
      <svg
        className="ambient-rings ambient-rings-spin absolute -right-44 -top-44 h-[660px] w-[660px] opacity-[0.10]"
        viewBox="0 0 600 600" fill="none"
      >
        {[70, 150, 230, 300].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} stroke="currentColor" strokeWidth="1" />
        ))}
        <circle cx="300" cy="300" r="6" fill="currentColor" />
        <line x1="300" y1="300" x2="300" y2="0" stroke="currentColor" strokeWidth="1" strokeDasharray="2 8" />
        <line x1="300" y1="300" x2="600" y2="300" stroke="currentColor" strokeWidth="1" strokeDasharray="2 8" />
      </svg>

      {/* Anneaux radar — bas-gauche, plus discret (balayage inverse) */}
      <svg
        className="ambient-rings ambient-rings-spin-r absolute -left-56 -bottom-56 h-[720px] w-[720px] opacity-[0.06]"
        viewBox="0 0 600 600" fill="none"
      >
        {[110, 210, 300].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} stroke="currentColor" strokeWidth="1" />
        ))}
      </svg>
    </div>
  );
}
