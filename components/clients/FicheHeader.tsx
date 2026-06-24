import Link from "next/link";
import { ArrowLeft, Hash, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RgpdExportButton } from "@/components/clients/RgpdExportButton";

/**
 * En-tête « identité » de la fiche client.
 *
 * Présentationnel uniquement : met en scène des données DÉJÀ présentes (nom,
 * code, type, commercial) + les actions existantes (retour, export RGPD).
 * Aucune nouvelle donnée ni action — montée en gamme visuelle seule.
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
}

export function FicheHeader({ clientId, name, code, type, commercial, admin }: FicheHeaderProps) {
  const badge = type ? TYPE_BADGE[type] : undefined;

  return (
    <header className="space-y-4">
      {/* Barre utilitaire */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/clients"
          className="group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Clients
        </Link>
        {admin && <RgpdExportButton clientId={clientId} />}
      </div>

      {/* Panneau identité */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {/* halo d'accent discret */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
          {/* Monogramme */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--brand-600))] sm:h-16 sm:w-16">
            <span className="font-display text-[22px] font-semibold tracking-tight sm:text-[26px]">
              {initials(name)}
            </span>
          </div>

          {/* Identité */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="min-w-0 break-words font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[33px]">
                {name}
              </h1>
              {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/70 px-2 py-1 font-mono text-[11.5px] font-medium text-foreground/80 ring-1 ring-border">
                <Hash className="h-3 w-3 opacity-60" />
                {code}
              </span>
              {commercial && (
                <>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-border" />
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5 opacity-60" />
                    Suivi par <span className="font-medium text-foreground">{commercial}</span>
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
