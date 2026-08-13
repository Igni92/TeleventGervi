"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MobileTiles } from "@/components/mobile/MobileTiles";
import { KpiStrip } from "./KpiStrip";
import { SecondScreenButton } from "./SecondScreenButton";
import { DernieresCommandes } from "./DernieresCommandes";
import { PromosAccueil } from "./PromosAccueil";

/**
 * Accueil — hub principal de TeleVent (« / »).
 *
 * Chaque panneau fetch son endpoint de façon défensive (useJson) : un service
 * en panne dégrade UN panneau, jamais la page.
 *
 * ⚠️ Perf : l'horloge (useNow, tick 30 s) est ISOLÉE dans <HubHeader> pour ne PAS
 * re-rendre les 5 panneaux toutes les 30 secondes.
 */

/** Horloge légère — montée côté client uniquement (pas de mismatch SSR). */
function useNow(refreshMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);
  return now;
}

/**
 * En-tête salutation + date + horloge — SEUL composant re-rendu au tick 30 s.
 * NB : la météo n'habite plus l'en-tête — elle est remontée dans la bande du
 * haut de la coquille (TopStrip), sur la même ligne que les événements.
 */
function HubHeader({ firstName }: { firstName: string | null }) {
  const now = useNow();
  const hour = now?.getHours() ?? 9;
  const salutation = hour >= 18 || hour < 4 ? "Bonsoir" : "Bonjour";
  const dateLongue = now
    ? now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
  const heure = now
    ? now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <header className="flex items-end justify-between gap-6 flex-wrap">
      <div>
        <p className="kicker mb-1.5">Accueil · vue d&apos;ensemble</p>
        <h1 className="font-display text-[32px] font-semibold text-foreground tracking-tight leading-none">
          {salutation}
          {firstName ? ` ${firstName}` : ""}
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2">
          L&apos;activité du jour !
        </p>
      </div>
      <div className="text-right shrink-0" aria-live="off">
        <p className="font-display text-[26px] font-semibold text-foreground leading-none tnum min-h-[26px]">
          {heure || " "}
        </p>
        <p className="text-[11.5px] text-muted-foreground mt-1.5 min-h-[14px]">
          {dateLongue ? dateLongue.charAt(0).toUpperCase() + dateLongue.slice(1) : " "}
        </p>
      </div>
    </header>
  );
}

export function AccueilHub() {
  const { data: session } = useSession();
  const firstName = (session?.user?.name ?? "").trim().split(/\s+/)[0] || null;

  return (
    <div className="keep-bricks flex flex-col gap-3 animate-fade-up max-sm:py-3">
      {/* ── Haut : bouton « 2ᵉ écran » EN HAUT À GAUCHE, puis salutation + horloge ── */}
      <div className="flex items-center gap-4">
        <SecondScreenButton />
        <div className="min-w-0 flex-1"><HubHeader firstName={firstName} /></div>
      </div>

      {/* ── MOBILE : lanceur en tuiles (4 axes) ── */}
      <MobileTiles className="md:hidden touch:!block" />

      {/* ── BUREAU : KPI (avec bulles de survol) + commandes + promotions ── */}
      <div className="hidden md:flex touch:!hidden flex-col gap-3">
        <KpiStrip />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-7 min-w-0">
            <DernieresCommandes />
          </div>
          <div className="lg:col-span-5 min-w-0">
            <PromosAccueil />
          </div>
        </div>
      </div>
    </div>
  );
}
