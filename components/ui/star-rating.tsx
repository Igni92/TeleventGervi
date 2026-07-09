"use client";

import { useState } from "react";
import { Star } from "lucide-react";

/**
 * Note en ÉTOILES (1 à 5) — qualité de la marchandise.
 *   • interactif (onChange fourni) : clic sur une étoile = note ; re-clic sur la
 *     note courante = efface (null).
 *   • lecture seule (onChange absent) : affiche la note, étoiles pleines/vides.
 */
const SIZES = { sm: "h-3 w-3", md: "h-4 w-4", lg: "h-5 w-5" } as const;

export function StarRating({
  value,
  onChange,
  size = "md",
  className = "",
  ariaLabel = "Note qualité",
}: {
  value: number | null | undefined;
  onChange?: (v: number | null) => void;
  size?: keyof typeof SIZES;
  className?: string;
  ariaLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const readOnly = !onChange;
  const shown = hover ?? value ?? 0;
  const cls = SIZES[size];

  if (readOnly) {
    if (!value || value < 1) return null;
    return (
      <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={`${value} sur 5`} title={`Qualité ${value}/5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`${cls} ${i <= value ? "text-amber-400" : "text-muted-foreground/25"}`}
            fill={i <= value ? "currentColor" : "none"}
          />
        ))}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} role="radiogroup" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} étoile${i > 1 ? "s" : ""}`}
          onMouseEnter={() => setHover(i)}
          onClick={() => onChange?.(value === i ? null : i)}
          className="p-0.5 leading-none transition-transform hover:scale-110 active:scale-95"
        >
          <Star
            className={`${cls} ${i <= shown ? "text-amber-400" : "text-muted-foreground/40"}`}
            fill={i <= shown ? "currentColor" : "none"}
          />
        </button>
      ))}
    </span>
  );
}
