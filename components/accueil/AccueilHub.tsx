"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PromoBanner } from "@/components/promos/PromoBanner";
import { MobileTiles } from "@/components/mobile/MobileTiles";
import { MeteoBar } from "./MeteoBar";
import { KpiStrip } from "./KpiStrip";
import { PoidsFamilles } from "./PoidsFamilles";
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
 * `meteo` (élément créé par le parent, référence stable) se loge à gauche de
 * l'horloge : React saute son re-rendu à chaque tick.
 */
function HubHeader({ firstName, meteo }: { firstName: string | null; meteo?: React.ReactNode }) {
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
      <div className="flex items-center gap-5 min-w-0">
        {meteo}
        <div className="text-right shrink-0" aria-live="off">
          <p className="font-display text-[26px] font-semibold text-foreground leading-none tnum min-h-[26px]">
            {heure || " "}
          </p>
          <p className="text-[11.5px] text-muted-foreground mt-1.5 min-h-[14px]">
            {dateLongue ? dateLongue.charAt(0).toUpperCase() + dateLongue.slice(1) : " "}
          </p>
        </div>
      </div>
    </header>
  );
}

export function AccueilHub() {
  const { data: session } = useSession();
  const firstName = (session?.user?.name ?? "").trim().split(/\s+/)[0] || null;

  return (
    <div className="keep-bricks space-y-4 animate-fade-up max-sm:py-3">
      {/* Météo compacte EN HAUT À DROITE (dans l'en-tête, à gauche de l'horloge) :
          aucune hauteur ajoutée — l'accueil doit tenir sans défilement. Desktop
          uniquement (le mobile a ses tuiles). */}
      <HubHeader
        firstName={firstName}
        meteo={<div className="hidden lg:block min-w-0"><MeteoBar /></div>}
      />

      {/* ── Bandeau promotions ── */}
      <PromoBanner context="accueil" />

      {/* ── MOBILE : lanceur en tuiles (4 axes) — écran volontairement différent du bureau ── */}
      <MobileTiles className="md:hidden touch:!block" />

      {/* ── BUREAU : KPI + poids par fruit + bento ── */}
      <div className="hidden md:block touch:!hidden space-y-4">
        <KpiStrip />
        <PoidsFamilles />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-7 space-y-4 min-w-0">
            <DernieresCommandes />
          </div>
          <div className="lg:col-span-5 space-y-4 min-w-0">
            <PromosAccueil />
          </div>
        </div>
      </div>
    </div>
  );
}
