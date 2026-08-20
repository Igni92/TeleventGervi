"use client";

import * as React from "react";
import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown } from "lucide-react";
import type { ClientInsights } from "@/lib/insights";
import { dayOfWeekLabel, summaryRecommendation, pickupSlotLabel } from "@/lib/insights";

/*
 * InsightsBlock — « Analyse comportementale » fondue dans le langage de section
 * du centre : titre body semibold + hairline, sans icône, sans accent, sans
 * carte. 4 métriques visibles au plus (Décroche le plus, Fréquence, Dernière
 * commande, Tendance) ; le reste vit derrière « Plus ».
 */
export function InsightsBlock({
  insights, collapsible, collapsed, onToggle,
}: {
  insights: ClientInsights;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  // Métriques secondaires repliées par défaut (montrées via « Plus »).
  const [showMore, setShowMore] = useState(false);

  const reco = summaryRecommendation(insights);
  const TrendIcon = insights.trend30 === "rising"  ? TrendingUp
                  : insights.trend30 === "falling" ? TrendingDown
                  :                                  Minus;
  const trendColor = insights.trend30 === "rising"  ? "text-success"
                   : insights.trend30 === "falling" ? "text-destructive"
                   :                                  "text-muted-foreground";

  // Libellé de fiabilité — discret, en simple texte muté (pas de pastille).
  const confidenceLabel =
    insights.confidence === "high" ? "fiable"
    : insights.confidence === "medium" ? "moyen"
    : "données limitées";

  // ── Métriques principales (max 4 visibles) ──────────────────────
  const primary: React.ReactNode[] = [];
  if (insights.bestPickup) {
    primary.push(
      <Metric key="pickup" label="Décroche le plus" value={pickupSlotLabel(insights.bestPickup)}
        hint={`${insights.bestPickup.rate}% · ${insights.bestPickup.attempts} tent.`} />,
    );
  } else if (insights.answerRate !== null) {
    primary.push(
      <Metric key="answer" label="Taux de décroché" value={`${insights.answerRate}%`}
        hint={`${insights.connectedCount}/${insights.attemptsCount} tent.`} />,
    );
  }
  if (insights.medianIntervalDays !== null) {
    primary.push(
      <Metric key="freq" label="Fréquence" value={`~${insights.medianIntervalDays} j`}
        hint={
          insights.cadenceStatus === "overdue" ? "en retard sur sa cadence"
          : insights.cadenceStatus === "due" ? "à commander bientôt"
          : "entre commandes"
        } />,
    );
  }
  if (insights.lastOrderDays !== null) {
    primary.push(
      <Metric key="last" label="Dernière commande"
        value={insights.lastOrderDays === 0 ? "Aujourd'hui"
             : insights.lastOrderDays === 1 ? "Hier"
             : `il y a ${insights.lastOrderDays} j`} />,
    );
  }
  if (insights.trend30) {
    primary.push(
      <Metric key="trend" label="Tendance 30 j"
        value={
          <span className={`inline-flex items-center gap-1 ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            {insights.trend30 === "rising" ? "En hausse" : insights.trend30 === "falling" ? "En baisse" : "Stable"}
          </span>
        } />,
    );
  }

  // ── Métriques secondaires (derrière « Plus ») ───────────────────
  const extra: React.ReactNode[] = [];
  if (insights.bestHour) {
    extra.push(
      <Metric key="hour" label="Commande le plus"
        value={insights.hourWindow ? `${insights.hourWindow.start}h – ${insights.hourWindow.end}h` : `${insights.bestHour.hour}h`}
        hint={`${insights.bestHour.share}% des cdes`} />,
    );
  }
  if (insights.bestDayOfWeek) {
    extra.push(
      <Metric key="dow" label="Meilleur jour" value={dayOfWeekLabel(insights.bestDayOfWeek.dow)}
        hint={`${insights.bestDayOfWeek.share}% des cdes`} />,
    );
  }
  if (insights.conversionRate !== null) {
    extra.push(
      <Metric key="conv" label="Conversion" value={`${insights.conversionRate}%`}
        hint={`${insights.ordersCount}/${insights.callsCount} appels`} />,
    );
  }

  // En-tête : même langage que les autres sections du centre.
  const header = (
    <div className={`flex items-center gap-2 ${collapsed ? "" : "border-b border-border pb-1.5 mb-3"}`}>
      <p className="text-body font-semibold text-foreground">Analyse comportementale</p>
      <span className="text-caption2 text-muted-foreground">· {confidenceLabel}</span>
      {collapsible && (
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-muted-foreground/60 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
      )}
    </div>
  );

  return (
    <section>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="w-full text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-secondary/40 transition-colors"
        >
          {header}
        </button>
      ) : (
        header
      )}

      {!collapsed && (
        <div className="pl-1">
          {reco && (
            <p className="text-body text-foreground/90 leading-snug mb-4">{reco}</p>
          )}

          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            {primary}
            {showMore && extra}
          </div>

          {extra.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              className="mt-3 inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMore ? "rotate-180" : ""}`} />
              {showMore ? "Moins" : "Plus"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({
  label, value, hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-caption2 text-muted-foreground">{label}</p>
      <p className="text-callout font-semibold text-foreground mt-0.5 tnum tracking-tight">{value}</p>
      {hint && <p className="text-caption2 text-muted-foreground/80 mt-0.5">{hint}</p>}
    </div>
  );
}
