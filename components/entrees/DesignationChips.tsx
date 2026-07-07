import * as React from "react";

/**
 * Tags désignation (mêmes couleurs que la liste stock / l'Écran 2) :
 *   marque = violet · conditionnement = bleu · calibre = teal · origine = ambre.
 * Rendu uniquement des valeurs présentes (≠ vide / « — »).
 */
const CHIP = "inline-flex items-center px-1.5 py-px rounded-[5px] text-[10.5px] font-semibold";
// Variante « md » — plus grosse, pour les écrans de PRÉPARATION lus au téléphone
// (le préparateur doit lire conditionnement / origine d'un coup d'œil).
const CHIP_MD = "inline-flex items-center px-2 py-0.5 rounded-md text-[12px] sm:text-[11px] font-semibold";
const STYLES = {
  marque: "bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100 dark:ring-1 dark:ring-inset dark:ring-violet-400/50",
  condt: "bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100 dark:ring-1 dark:ring-inset dark:ring-sky-400/50",
  calibre: "bg-teal-100 text-teal-800 dark:bg-teal-500/30 dark:text-teal-100 dark:ring-1 dark:ring-inset dark:ring-teal-400/50",
  pays: "bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-400/50",
};
const ok = (v?: string | null) => !!v && v.trim() !== "" && v.trim() !== "—" && v.trim() !== "-";

/** Chip unitaire (cellule de tableau) — même palette que DesignationChips. */
export function Chip({ kind, children }: { kind: keyof typeof STYLES; children: React.ReactNode }) {
  if (!ok(typeof children === "string" ? children : "x")) return <span className="text-muted-foreground/50">—</span>;
  return <span className={`${CHIP} ${STYLES[kind]}`}>{children}</span>;
}

export function DesignationChips({
  marque, condt, calibre, pays, className, size = "sm",
}: {
  marque?: string | null; condt?: string | null; calibre?: string | null; pays?: string | null;
  className?: string;
  /** « md » = tags plus gros pour la préparation au téléphone (défaut « sm »). */
  size?: "sm" | "md";
}) {
  const chips: [keyof typeof STYLES, string][] = [];
  if (ok(marque)) chips.push(["marque", marque!.trim()]);
  if (ok(condt)) chips.push(["condt", condt!.trim()]);
  if (ok(calibre)) chips.push(["calibre", calibre!.trim()]);
  if (ok(pays)) chips.push(["pays", pays!.trim()]);
  if (chips.length === 0) return null;
  const base = size === "md" ? CHIP_MD : CHIP;
  return (
    <span className={`flex items-center gap-1 flex-wrap ${className ?? ""}`}>
      {chips.map(([k, txt], i) => (
        <span key={i} className={`${base} ${STYLES[k]}`}>{txt}</span>
      ))}
    </span>
  );
}
