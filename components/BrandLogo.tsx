import * as React from "react";

/**
 * Logo de marque réutilisable. Taille NORMALISÉE par la HAUTEUR : tous les logos
 * s'affichent à la même hauteur quelle que soit la forme du fichier source
 * (carré, paysage, portrait) → rendu uniforme « rangée de logos ». La largeur
 * suit le ratio (plafonnée pour ne pas déborder ; object-contain évite toute
 * déformation si le plafond est atteint).
 *
 * Rend `null` si la marque n'a pas de logo (ou si l'affichage des logos est
 * désactivé dans les paramètres → la Map fournie est vide).
 */
const SIZES = {
  sm: "h-9 max-w-[90px]",    // listes compactes
  md: "h-11 max-w-[120px]",  // table préparation, récap
  lg: "h-14 max-w-[150px]",  // écrans focalisés (comptage guidé, vue en grand)
  xl: "h-16 max-w-[170px]",  // liste console
} as const;

/** Valeur de marque exploitable (ignore les placeholders vides « - », « — », « . »). */
export function logoFor(
  logos: Map<string, string> | undefined,
  marque?: string | null,
): string | undefined {
  if (!logos || !marque) return undefined;
  const t = marque.trim().toLowerCase();
  if (!t || t === "-" || t === "—" || t === ".") return undefined;
  return logos.get(t);
}

export function BrandLogo({
  marque,
  logos,
  size = "md",
  className = "",
}: {
  marque?: string | null;
  logos: Map<string, string> | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const src = logoFor(logos, marque);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={marque ?? ""}
      title={marque ?? undefined}
      className={`${SIZES[size]} w-auto shrink-0 rounded-sm object-contain ${className}`}
    />
  );
}
