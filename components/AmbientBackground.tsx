import { AmbientMotionGate } from "@/components/settings/AmbientMotionGate";

/**
 * Fond ambiant global — version APAISÉE (redesign 07/2026).
 *
 * L'ancienne DA « salle de signal » (2 auroras multicolores + grille technique
 * + anneaux radar) faisait très « template IA ». On garde UNE seule nappe de
 * teinte marque, très discrète, qui donne de la matière aux marges sans jamais
 * concurrencer les données. Server component (aucun hook).
 *
 * Le réglage televente:animations (page /parametres) reste honoré par
 * `AmbientMotionGate` (pose `data-reduce-anim="1"` / `data-anim="force"`).
 */
export function AmbientBackground() {
  return (
    // Mobile : AUCUNE ambiance — une app pro n'a pas de fond décoratif,
    // la surface est parfaitement plate (cf. globals.css « une seule surface »).
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden hidden sm:block">
      <AmbientMotionGate />
      <div className="ambient-aurora" />
    </div>
  );
}
