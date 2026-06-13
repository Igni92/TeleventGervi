import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeltaProps {
  /** valeur courante */
  curr: number;
  /** valeur de comparaison (N-1) */
  prev: number;
  /** afficher en points de % absolus plutôt qu'en variation relative */
  className?: string;
  size?: "sm" | "md";
}

/**
 * Pastille de variation YoY (N vs N-1).
 *
 * Accessibilité (cf. color-not-only) : la tendance est portée par l'ICÔNE +
 * le SIGNE (+/−), pas seulement la couleur. Un lecteur d'écran lit le texte.
 * "new" si N-1 = 0 mais N > 0 (création récente — pas de % trompeur).
 */
export function Delta({ curr, prev, className, size = "md" }: DeltaProps) {
  // Base N-1 valide si ≠ 0 ; division par |prev| pour gérer les marges négatives.
  const hasBase = prev !== 0;
  const pct = hasBase ? ((curr - prev) / Math.abs(prev)) * 100 : 0;
  const up = pct > 0.5;
  const down = pct < -0.5;
  const flat = !up && !down;

  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const tone = up
    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
    : down
      ? "text-rose-600 dark:text-rose-400 bg-rose-500/10"
      : "text-muted-foreground bg-secondary/60";

  const label = !hasBase
    ? curr > 0 ? "nouveau" : "—"
    : `${pct > 0 ? "+" : ""}${pct.toFixed(pct >= 10 || pct <= -10 ? 0 : 1)} %`;

  const sz = size === "sm" ? "text-[10px] px-1.5 h-4 gap-0.5" : "text-[11px] px-2 h-5 gap-1";
  const iconSz = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <span
      className={cn("inline-flex items-center rounded-full font-semibold tnum", sz, tone, className)}
      title={hasBase ? `N-1 : ${new Intl.NumberFormat("fr-FR").format(Math.round(prev))}` : "Pas de donnée N-1"}
    >
      {!flat || hasBase ? <Icon className={iconSz} aria-hidden /> : null}
      {label}
    </span>
  );
}
