import * as React from "react";

/**
 * Logo de marque réutilisable, rendu dans une TUILE BLANCHE CARRÉE uniforme :
 * même taille et même fond partout, logo centré en `object-contain`. Cela
 * homogénéise tous les logos quelle que soit la forme/le fond du fichier source
 * (transparent, blanc, paysage, carré…) et aligne proprement le texte qui suit.
 *
 * Rend `null` si la marque n'a pas de logo (ou si l'affichage est désactivé
 * pour la zone → la Map fournie est vide).
 */
const SIZES = {
  sm: "h-10 w-10 p-1",       // listes compactes (recherche)
  md: "h-12 w-12 p-1",       // table préparation, récap
  lg: "h-14 w-14 p-1.5",     // écrans focalisés (comptage guidé, vue en grand)
  xl: "h-16 w-16 p-1.5",     // liste console
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
    <span
      className={`${SIZES[size]} shrink-0 inline-flex items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-black/10 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={marque ?? ""}
        title={marque ?? undefined}
        className="max-h-full max-w-full object-contain"
      />
    </span>
  );
}
