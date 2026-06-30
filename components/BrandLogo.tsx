import * as React from "react";

/**
 * Logo de marque réutilisable — taille centralisée pour rester cohérent partout
 * (console liste produits, détail livraison/préparation, inventaire du stock).
 * Rend `null` si la marque n'a pas de logo associé → aucune place réservée.
 */
const SIZES = {
  sm: "h-9 w-9",     // listes compactes
  md: "h-12 w-12",   // table préparation, récap
  lg: "h-16 w-16",   // écrans focalisés (comptage guidé, vue en grand)
  xl: "h-16 w-28",   // liste console — logo bien visible, occupe l'espace dispo
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
      className={`${SIZES[size]} shrink-0 rounded-sm object-contain ${className}`}
    />
  );
}
