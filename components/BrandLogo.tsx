"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Logo de marque réutilisable, rendu dans une TUILE BLANCHE CARRÉE uniforme :
 * même taille et même fond partout, logo centré en `object-contain`. Cela
 * homogénéise tous les logos quelle que soit la forme/le fond du fichier source
 * (transparent, blanc, paysage, carré…) et aligne proprement le texte qui suit.
 *
 * `zoomable` : le logo devient cliquable → ouvre une vue agrandie (lightbox).
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

/** Vue agrandie du logo (overlay plein écran). Fermeture : clic fond / Échap / croix. */
function LogoLightbox({ src, marque, onClose }: { src: string; marque?: string | null; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm p-6 animate-fade-up"
      role="dialog"
      aria-modal="true"
      aria-label={marque ? `Logo ${marque}` : "Logo"}
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <span className="block rounded-2xl bg-white ring-1 ring-black/10 p-6 shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={marque ?? ""}
            className="block max-h-[60vh] w-auto max-w-[min(85vw,420px)] object-contain"
          />
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute -right-3 -top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-foreground shadow-lg ring-1 ring-black/10 hover:bg-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {marque && <p className="text-[13px] font-semibold text-white/90">{marque}</p>}
    </div>,
    document.body,
  );
}

export function BrandLogo({
  marque,
  logos,
  size = "md",
  className = "",
  zoomable = false,
}: {
  marque?: string | null;
  logos: Map<string, string> | undefined;
  size?: keyof typeof SIZES;
  className?: string;
  /** Cliquable → ouvre le logo en grand (lightbox). */
  zoomable?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const src = logoFor(logos, marque);
  if (!src) return null;

  const tileClass = `${SIZES[size]} shrink-0 inline-flex items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-black/10 ${className}`;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={marque ?? ""} title={marque ?? undefined} className="max-h-full max-w-full object-contain" />
  );

  if (!zoomable) return <span className={tileClass}>{img}</span>;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={marque ? `Agrandir — ${marque}` : "Agrandir le logo"}
        aria-label={marque ? `Agrandir le logo ${marque}` : "Agrandir le logo"}
        className={`${tileClass} cursor-zoom-in transition hover:ring-black/25 hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
      >
        {img}
      </button>
      {open && <LogoLightbox src={src} marque={marque} onClose={() => setOpen(false)} />}
    </>
  );
}
