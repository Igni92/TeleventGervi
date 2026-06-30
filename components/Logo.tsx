import type { SVGProps } from "react";

/**
 * Identité Gervi — grossiste primeur / fraise.
 *
 * Pictogramme géométrique et premium (esprit Linear/Stripe, surtout pas un
 * emoji) : un corps de fraise en goutte inversée + une couronne (calice) à
 * trois folioles + deux akènes (les « graines »).
 *
 * Le corps suit `currentColor` (lisible sur fond sombre comme clair selon la
 * couleur de texte héritée) ; la couronne et un akène prennent l'accent de
 * marque via les tokens `--brand-*`, donc la colorimétrie commutable (Or /
 * Agrume / Fraise) est respectée sans surcharge.
 */
export function Logo({
  className,
  withWordmark = false,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  const mark = <Mark className="h-[30px] w-[30px] shrink-0" />;

  if (!withWordmark) {
    return (
      <span className={className} aria-label="Gervi" role="img">
        {mark}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-2.5 select-none ${className ?? ""}`}
      aria-label="Gervi"
      role="img"
    >
      {mark}
      <span
        aria-hidden
        className="text-[19px] font-bold tracking-[-0.02em] leading-none"
      >
        Gerv<span className="text-brand-500">i</span>
      </span>
    </span>
  );
}

/**
 * Le symbole seul. `currentColor` colore le corps de la fraise ;
 * `text-brand-500` (hérité) teinte la couronne + un akène.
 */
function Mark({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      {/* Corps de la fraise — goutte inversée, formes épaisses lisibles à 16px */}
      <path
        d="M16 29.5c-5.4-2.2-9.5-7-9.5-12.4 0-3 2.1-5.3 5-5.9 1.5-.3 3-.1 4.5.5 1.5-.6 3-.8 4.5-.5 2.9.6 5 2.9 5 5.9 0 5.4-4.1 10.2-9.5 12.4Z"
        fill="currentColor"
      />
      {/* Couronne / calice — trois folioles, accent de marque */}
      <path
        d="M16 11.2c-.6-1.7-2-3-3.8-3.5.9-.5 2-.6 3-.3.1-1.4.9-2.7 2.1-3.4-.1 1.4.4 2.7 1.3 3.7 1-.6 2.2-.7 3.3-.4-1.6.8-2.7 2.2-3.1 3.9-.9-.3-1.9-.3-2.8 0Z"
        className="text-brand-500"
        fill="currentColor"
      />
      {/* Akènes — deux graines, l'une neutre l'autre accentuée */}
      <ellipse cx="13.4" cy="20" rx="1.05" ry="1.5" className="text-brand-300" fill="currentColor" />
      <ellipse cx="18.2" cy="22.6" rx="1.05" ry="1.5" fill="#0b1018" fillOpacity="0.28" />
    </svg>
  );
}
