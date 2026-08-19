"use client";

// Synthèse (StatLine), BARRE D'OUTILS UNIQUE (état + segment + recherche +
// repliage) et états vides / chargement du détail livraison.
//
// Refonte : plus d'aplats saturés multicolores sur les onglets — deux
// SegmentedControl NEUTRES (sélection = pastille carte + ombre), seuls les
// COMPTEURS portent une couleur d'état discrète. La SummaryRow de cartes
// bordées devient une StatLine inline sans bordures.
import {
  Truck, ChevronDown, CheckCircle2, Clock, Search, X, Store, PackageX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StatLine } from "@/components/ui/stat-line";
import { formatDeliveryDate } from "@/lib/livraison";
import { SEGMENT_LABEL, type SegmentTab } from "@/lib/livraisonView";
import type { Totals } from "@/lib/livraisonView";
import { fmtInt, fmtNum, fmtKg, type ViewTab } from "./shared";

/* ═════════════════════════════════════════════════════════════
   Synthèse — chiffres clés de la tournée, inline sans cartes
═════════════════════════════════════════════════════════════ */
export function SummaryStats({ totals }: { totals: Totals }) {
  // Volontairement trois chiffres seulement (Commandes · Colis · Poids) : ils
  // tiennent sur une seule ligne en mobile. Nombre de clients et Total HT
  // retirés (bruit pour le préparateur ; le CA reste sur les fiches).
  return (
    <StatLine
      items={[
        { label: "Commandes", value: fmtInt(totals.orders) },
        { label: "Colis", value: fmtNum(totals.colis) },
        { label: "Poids net", value: fmtKg(totals.weightKg) },
      ]}
    />
  );
}

/* ═════════════════════════════════════════════════════════════
   Barre d'outils unique — état · segment · recherche · repliage
═════════════════════════════════════════════════════════════ */

/** Compteur d'onglet : la couleur d'état reste sur le CHIFFRE uniquement,
 *  discrète (jamais d'aplat) ; un compteur à zéro s'efface. */
function Count({ n, tone }: { n: number; tone?: string }) {
  return (
    <span className={`tnum text-caption2 font-bold ${n === 0 ? "text-muted-foreground/50" : tone ?? "text-muted-foreground"}`}>
      {n}
    </span>
  );
}

export function Toolbar({
  tab, counts, onPick, showVentes,
  segment, segCounts, onSegment,
  query, onQuery, allCollapsed, onToggleAll,
}: {
  tab: ViewTab;
  counts: { ventes: number; aPreparer: number; fait: number; depart: number };
  onPick: (t: ViewTab) => void;
  /** Onglet « Ventes » (mise en préparation) — réservé au dispatch : les rôles
   *  restreints ne reçoivent jamais les BL pas encore lâchés (filtre serveur). */
  showVentes: boolean;
  segment: SegmentTab;
  segCounts: Record<SegmentTab, number>;
  onSegment: (s: SegmentTab) => void;
  query: string;
  onQuery: (q: string) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Filtre d'ÉTAT — segmented neutre, compteurs colorés discrètement.
          Sur mobile les icônes sont masquées : les libellés (« À préparer »)
          tiennent alors dans leur segment sans déborder. */}
      <SegmentedControl<ViewTab>
        aria-label="État des commandes"
        value={tab}
        onChange={onPick}
        className="max-sm:w-full"
        options={[
          ...(showVentes
            ? [{
                value: "VENTES" as ViewTab,
                icon: <span className="hidden sm:inline-flex"><Store aria-hidden /></span>,
                label: <>Ventes <Count n={counts.ventes} /></>,
              }]
            : []),
          {
            value: "A_PREPARER" as ViewTab,
            icon: <span className="hidden sm:inline-flex"><Clock aria-hidden /></span>,
            label: <>À préparer <Count n={counts.aPreparer} tone="text-warning" /></>,
          },
          {
            value: "FAIT" as ViewTab,
            icon: <span className="hidden sm:inline-flex"><CheckCircle2 aria-hidden /></span>,
            label: <>Fait <Count n={counts.fait} tone="text-success" /></>,
          },
          {
            value: "DEPART" as ViewTab,
            icon: <span className="hidden sm:inline-flex"><Truck aria-hidden /></span>,
            label: <>Départ <Count n={counts.depart} tone="text-info" /></>,
          },
        ]}
      />

      {/* Filtre SEGMENT client (Tout / CHR / Export / GMS) — MASQUÉ sur mobile :
          hors de propos pour un préparateur sur tablette, il encombrait la barre.
          Réservé au poste desktop (dispatch commercial). */}
      <SegmentedControl<SegmentTab>
        aria-label="Segment client"
        size="sm"
        value={segment}
        onChange={onSegment}
        className="hidden sm:flex"
        options={(["TOUT", "CHR", "EXPORT", "GMS"] as SegmentTab[]).map((s) => ({
          value: s,
          label: <>{SEGMENT_LABEL[s]} <Count n={segCounts[s]} /></>,
        }))}
      />

      {/* Recherche d'un bon : n° BL, client, code, réf. client. */}
      <div className="relative min-w-0 flex-1 sm:max-w-[260px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onQuery(""); }}
          placeholder="Chercher un bon (client, n° BL…)"
          aria-label="Chercher un bon de livraison (client, n° de BL, code ou réf. client)"
          className="h-11 w-full rounded-lg border border-border bg-card pl-8 pr-8 text-caption font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-brand-500/40 sm:h-8 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Effacer la recherche"
            className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onToggleAll}
        className="shrink-0 max-sm:h-11"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${allCollapsed ? "-rotate-90" : ""}`} />
        {allCollapsed ? "Tout déplier" : "Tout replier"}
      </Button>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   États vides / chargement
═════════════════════════════════════════════════════════════ */
export function DayEmptyState({ date }: { date: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card">
      <EmptyState
        icon={PackageX}
        title="Aucune commande à livrer"
        description={
          <>
            Rien n&apos;est planifié pour le {formatDeliveryDate(date)}. Changez de
            date ou actualisez si une commande vient d&apos;être saisie.
          </>
        }
      />
    </div>
  );
}

/** Squelette du premier chargement — silhouette de 2 groupes transporteur. */
export function LoadingState() {
  return (
    <div role="status" aria-label="Chargement des commandes" className="space-y-3">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex h-14 items-center gap-3 border-b border-border px-5">
            <Skeleton className="h-4 w-36 rounded-md" />
            <Skeleton className="ml-auto h-5 w-16 rounded-full" />
          </div>
          <div className="divide-y divide-border/60">
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex h-16 items-center px-5">
                <Skeleton className="h-4 w-44 rounded-md" />
                <Skeleton className="ml-auto h-6 w-10 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
