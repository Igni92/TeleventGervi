import {
  CheckCircle2,
  Clock,
  TriangleAlert,
  Moon,
  Ban,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LifecycleResult, LifecycleState } from "@/lib/lifecycle";
import type { ValueTier } from "@/lib/clientValue";

/**
 * Badge présentationnel du cycle de vie client (état dérivé par
 * `lib/lifecycle.ts`). Accessible : icône + texte, jamais la couleur seule.
 *
 * Réutilise le primitif <Badge> (variant `outline` neutre) puis applique des
 * classes de couleur SÉMANTIQUE par état — alignées sur la palette des autres
 * badges (sky/orange/emerald/amber/rose/slate). Le palier de valeur A/B/C/D est
 * optionnel et s'affiche en chip mono discret accolé.
 */

// Couleur SÉMANTIQUE par état, en pilule translucide /12 (lisible clair ET
// sombre — aligné sur le primitif <Badge>). La couleur ne code que l'état.
const STATE_STYLE: Record<LifecycleState, { icon: LucideIcon; className: string }> = {
  ACTIF: {
    icon: CheckCircle2,
    className: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20",
  },
  EN_RETARD: {
    icon: Clock,
    className: "bg-amber-500/12 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20",
  },
  A_RISQUE: {
    icon: TriangleAlert,
    className: "bg-orange-500/12 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/20",
  },
  ENDORMI: {
    icon: Moon,
    className: "bg-slate-500/12 text-slate-600 dark:text-slate-300 ring-1 ring-slate-500/20",
  },
  PERDU: {
    icon: Ban,
    className: "bg-rose-500/12 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20",
  },
  NOUVEAU: {
    icon: Sparkles,
    className: "bg-sky-500/12 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/20",
  },
};

interface LifecycleBadgeProps {
  lifecycle: LifecycleResult;
  /** Palier de valeur optionnel (A/B/C/D) — affiché en chip accolé. */
  tier?: ValueTier | null;
  className?: string;
}

export function LifecycleBadge({ lifecycle, tier, className }: LifecycleBadgeProps) {
  const style = STATE_STYLE[lifecycle.state];
  const Icon = style.icon;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Badge
        variant="outline"
        className={cn("gap-1 ring-0", style.className)}
        title={`Cycle de vie : ${lifecycle.label}`}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {lifecycle.label}
      </Badge>
      {tier && (
        <span
          className="inline-flex items-center rounded-md bg-secondary/70 px-1.5 py-0.5 font-mono text-caption2 font-semibold text-foreground/70 ring-1 ring-border"
          title={`Valeur client : ${tier.label}`}
        >
          {tier.tier}
        </span>
      )}
    </span>
  );
}
