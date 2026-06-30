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

const STATE_STYLE: Record<LifecycleState, { icon: LucideIcon; className: string }> = {
  ACTIF: {
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60",
  },
  EN_RETARD: {
    icon: Clock,
    className: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60",
  },
  A_RISQUE: {
    icon: TriangleAlert,
    className: "bg-orange-50 text-orange-700 ring-1 ring-orange-200/60",
  },
  ENDORMI: {
    icon: Moon,
    className: "bg-slate-100 text-slate-600 ring-1 ring-slate-200/80",
  },
  PERDU: {
    icon: Ban,
    className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60",
  },
  NOUVEAU: {
    icon: Sparkles,
    className: "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60",
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
          className="inline-flex items-center rounded-md bg-secondary/70 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground/70 ring-1 ring-border"
          title={`Valeur client : ${tier.label}`}
        >
          {tier.tier}
        </span>
      )}
    </span>
  );
}
