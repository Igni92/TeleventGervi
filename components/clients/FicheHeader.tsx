import Link from "next/link";
import { ArrowLeft, Hash, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RgpdExportButton } from "@/components/clients/RgpdExportButton";
import { LifecycleBadge } from "@/components/clients/LifecycleBadge";
import type { LifecycleResult } from "@/lib/lifecycle";
import type { ValueTier } from "@/lib/clientValue";

/**
 * En-tête de la fiche client (zone de PRISE D'INFO).
 *
 * Sobre et lisible : plus de chrome décoratif (radar SVG, barres live, pastille
 * pulsante, grille de fond, halo). Case d'info à teinte douce portant le
 * monogramme, le nom (title1), le code et les badges type / cycle de vie.
 * Présentationnel : met en scène des données déjà présentes + les actions
 * existantes (retour, export RGPD).
 */

const TYPE_BADGE: Record<string, { variant: "export" | "gms" | "chr"; label: string }> = {
  EXPORT: { variant: "export", label: "Export" },
  GMS:    { variant: "gms",    label: "GMS" },
  CHR:    { variant: "chr",    label: "CHR" },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface FicheHeaderProps {
  clientId: string;
  name: string;
  code: string;
  type?: string | null;
  commercial?: string | null;
  admin: boolean;
  /**
   * État du cycle de vie (dérivé par `lib/lifecycle.ts`). Optionnel : tant que
   * le câblage des signaux comportementaux n'est pas fait côté page, le badge
   * n'apparaît pas — additif, ne casse rien.
   */
  lifecycle?: LifecycleResult | null;
  /** Palier de valeur A/B/C/D (dérivé par `lib/clientValue.ts`). Optionnel. */
  tier?: ValueTier | null;
}

export function FicheHeader({ clientId, name, code, type, commercial, admin, lifecycle, tier }: FicheHeaderProps) {
  const badge = type ? TYPE_BADGE[type] : undefined;

  return (
    <header className="space-y-4">
      {/* Barre utilitaire */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/clients"
          className="group inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Clients
        </Link>
        {admin && <RgpdExportButton clientId={clientId} />}
      </div>

      {/* Case d'identité — teinte douce (zone de prise d'info) */}
      <div className="rounded-2xl border border-brand-500/20 bg-brand-500/[0.06] p-4 sm:p-5">
        <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:gap-4">
          {/* Monogramme */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-700 ring-1 ring-inset ring-brand-500/25 dark:text-brand-300 sm:h-14 sm:w-14">
            <span className="font-display text-title3 font-semibold">{initials(name)}</span>
          </div>

          {/* Identité */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 break-words font-display text-title1 font-semibold text-foreground">
                {name}
              </h1>
              {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
              {lifecycle && <LifecycleBadge lifecycle={lifecycle} tier={tier} />}
            </div>

            {/* Coordonnées : code + commercial */}
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/70 px-2 py-1 font-mono text-caption2 font-medium text-foreground/80 ring-1 ring-border">
                <Hash className="h-3 w-3 opacity-60" />
                {code}
              </span>
              {commercial && (
                <>
                  <span aria-hidden className="h-3 w-px bg-border" />
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5 opacity-60" />
                    <span className="font-medium text-foreground">{commercial}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
