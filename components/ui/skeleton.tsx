import { cn } from "@/lib/utils";

/**
 * Bloc squelette réutilisable (shimmer).
 *
 * S'appuie sur la classe `.skeleton` de globals.css (dégradé animé), figée en
 * `prefers-reduced-motion` (fond muté statique). Décoratif → `aria-hidden` :
 * l'état de chargement accessible est porté par un `role="status"` parent.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton", className)} {...props} />;
}
