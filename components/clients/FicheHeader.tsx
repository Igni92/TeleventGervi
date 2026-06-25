import Link from "next/link";
import { ArrowLeft, Hash, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RgpdExportButton } from "@/components/clients/RgpdExportButton";

/**
 * En-tête « console d'identité » de la fiche client (DA « salle de signal »).
 *
 * Présentationnel uniquement : met en scène des données DÉJÀ présentes (nom,
 * code, type, commercial) + les actions existantes (retour, export RGPD).
 * Signature : rail d'accent vertical (écho au logo waveform), anneaux radar en
 * écho au fond d'ambiance global, monogramme « jeton signal » à status-light,
 * barre de coordonnées (code mono + filets + label OP) et barres « live ».
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

/** Anneaux radar — écho DIRECT au motif d'AmbientBackground (salle de signal). */
function RadarRings() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 text-brand-400 opacity-[0.13] animate-fade-in"
    >
      {[34, 58, 82, 100].map((r, i) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="1" opacity={1 - i * 0.18} />
      ))}
      <line x1="100" y1="0" x2="100" y2="200" stroke="currentColor" strokeWidth="1" strokeDasharray="2 9" />
      <line x1="0" y1="100" x2="200" y2="100" stroke="currentColor" strokeWidth="1" strokeDasharray="2 9" />
    </svg>
  );
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
          className="group inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Clients
        </Link>
        {admin && <RgpdExportButton clientId={clientId} />}
      </div>

      {/* Console identité */}
      <div className="relative isolate overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {/* Rail d'accent vertical — écho au logo signal/waveform */}
        <span aria-hidden className="absolute inset-y-0 left-0 z-[1] w-1 bg-gradient-to-b from-brand-400 to-brand-600" />
        {/* Liseré supérieur capteur d'aurora */}
        <span aria-hidden className="absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-brand-400/55 to-transparent" />
        {/* Couches d'ambiance (sous le contenu) */}
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 -z-10 h-56 w-56 rounded-full bg-brand-500/12 blur-3xl" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(hsl(var(--foreground)/0.05)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--foreground)/0.05)_1px,transparent_1px)] [background-size:34px_34px] [mask-image:radial-gradient(ellipse_70%_80%_at_85%_20%,#000,transparent_75%)]"
        />
        <RadarRings />

        <div className="relative z-10 flex flex-col gap-3.5 p-4 pl-5 sm:flex-row sm:items-center sm:gap-4 sm:p-5 sm:pl-6">
          {/* Monogramme « jeton signal » */}
          <div className="relative h-12 w-12 shrink-0 sm:h-14 sm:w-14">
            <div className="flex h-full w-full items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--brand-600))] ring-1 ring-inset ring-white/15">
              <span className="font-display text-[20px] font-semibold tracking-tight sm:text-[23px]">
                {initials(name)}
              </span>
            </div>
            {/* status-light : fiche active (décoratif) */}
            <span aria-hidden className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card animate-soft-pulse" />
          </div>

          {/* Identité */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 break-words font-display text-[23px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[29px]">
                {name}
              </h1>
              {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
            </div>

            {/* Barre de coordonnées */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/70 px-2 py-1 font-mono text-[11.5px] font-medium text-foreground/80 ring-1 ring-border">
                <Hash className="h-3 w-3 opacity-60" />
                {code}
              </span>
              {commercial && (
                <>
                  <span aria-hidden className="h-3 w-px bg-border" />
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">OP</span>
                    <UserRound className="h-3.5 w-3.5 opacity-60" />
                    <span className="font-medium text-foreground">{commercial}</span>
                  </span>
                </>
              )}
              {/* Barres « live » (décoratif, écho au loader signal) */}
              <span aria-hidden className="ml-auto hidden items-end gap-0.5 sm:flex">
                <span className="signal-bar h-2 w-0.5 rounded-full bg-brand-400/70" />
                <span className="signal-bar h-3 w-0.5 rounded-full bg-brand-400/70 [animation-delay:120ms]" />
                <span className="signal-bar h-2 w-0.5 rounded-full bg-brand-400/70 [animation-delay:240ms]" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
