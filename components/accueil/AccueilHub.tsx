"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PromoBanner } from "@/components/promos/PromoBanner";
import { KpiStrip } from "./KpiStrip";
import { ModuleGrid } from "./ModuleGrid";
import { DernieresCommandes } from "./DernieresCommandes";
import { AlertesEncours } from "./AlertesEncours";
import { PromosAccueil } from "./PromosAccueil";

/**
 * Accueil — hub principal de TeleVent (« / »).
 *
 * Bento sans scroll interminable (pensé pour tenir sur 1920×1080) :
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Salutation + date · · · · · · · · · · · · · horloge      │
 *   │ <PromoBanner context="accueil" /> (bandeau pleine large.)│
 *   │ [CA jour] [Volume kg] [Commandes] [Clients servis]       │
 *   │ ┌──────────── 7/12 ───────────┐ ┌──────── 5/12 ────────┐ │
 *   │ │ Modules (10 tuiles)         │ │ Alertes encours      │ │
 *   │ │ Dernières commandes         │ │ Promotions (+ nouv.) │ │
 *   │ └─────────────────────────────┘ └──────────────────────┘ │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Chaque panneau fetch son endpoint de façon défensive (useJson) : un service
 * en panne dégrade UN panneau, jamais la page.
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

export function AccueilHub() {
  const { data: session } = useSession();
  const now = useNow();

  const firstName = (session?.user?.name ?? "").trim().split(/\s+/)[0] || null;
  const hour = now?.getHours() ?? 9;
  const salutation = hour >= 18 || hour < 4 ? "Bonsoir" : "Bonjour";

  const dateLongue = now
    ? now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
  const heure = now
    ? now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="space-y-4 animate-fade-up">
      {/* ── En-tête : salutation + date + horloge ─────────── */}
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p className="kicker mb-1.5">Accueil · vue d&apos;ensemble</p>
          <h1 className="font-display text-[32px] font-semibold text-foreground tracking-tight leading-none">
            {salutation}
            {firstName ? ` ${firstName}` : ""}
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-2">
            Voici l&apos;activité du jour en un coup d&apos;œil.
          </p>
        </div>
        <div className="text-right" aria-live="off">
          <p className="font-display text-[26px] font-semibold text-foreground leading-none tnum min-h-[26px]">
            {heure || " "}
          </p>
          <p className="text-[11.5px] text-muted-foreground mt-1.5 min-h-[14px]">
            {dateLongue ? dateLongue.charAt(0).toUpperCase() + dateLongue.slice(1) : " "}
          </p>
        </div>
      </header>

      {/* ── Bandeau promotions (chantier parallèle — stub ok) ── */}
      <PromoBanner context="accueil" />

      {/* ── KPI du jour ────────────────────────────────────── */}
      <KpiStrip />

      {/* ── Bento principal ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 space-y-4 min-w-0">
          <ModuleGrid />
          <DernieresCommandes />
        </div>
        <div className="lg:col-span-5 space-y-4 min-w-0">
          <AlertesEncours />
          <PromosAccueil />
        </div>
      </div>
    </div>
  );
}
