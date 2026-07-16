"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileDown, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEGMENTS, type Segment } from "@/lib/segments";

/**
 * Export des données de l'onglet Statistiques (/dashboard) en UN fichier JSON.
 *
 * Pensé pour l'analyse externe (Claude / Claude Cowork) : on interroge les
 * MÊMES routes API que le dashboard — donc mêmes chiffres, même périmètre de
 * droits (un commercial exporte SON activité, un admin le global) — et on
 * assemble le tout dans un fichier auto-documenté (section `lisezMoi`) que
 * l'utilisateur n'a plus qu'à glisser dans une conversation.
 *
 * Jeux de données embarqués (= tout ce que montre l'onglet Stats) :
 *   • Écran 1 — Activité BL : KPIs jour/semaine/mois (N vs N-1, CRM, tops)
 *                + série hebdomadaire du volume BL.
 *   • Écran 2 — Rapport annuel comptable PAR SEGMENT (matrice mois × années,
 *                tops clients/fournisseurs/commerciaux) + série hebdo CA/marge
 *                + clients à relancer.
 *   • Écran 3 — Carte : facturé 12 mois glissants par zone géographique.
 *
 * Robustesse : chaque jeu est récupéré indépendamment (pool de 4 requêtes) ;
 * un échec ponctuel n'annule pas l'export, il est consigné dans `meta.erreurs`.
 */

interface Job {
  /** Libellé humain (progression + rapport d'erreurs). */
  label: string;
  url: string;
  /** Range le JSON reçu à sa place dans l'arborescence d'export. */
  assign: (root: ExportRoot, data: unknown) => void;
}

interface ExportRoot {
  meta: {
    titre: string;
    application: string;
    source: string;
    genereLe: string;
    lisezMoi: string[];
    erreurs: { jeu: string; erreur: string }[];
  };
  activite: {
    jour: unknown;
    semaine: unknown;
    mois: unknown;
    serieHebdomadaireVolume: unknown;
  };
  rapportAnnuel: Partial<Record<Segment, unknown>>;
  facturationHebdomadaire: Partial<Record<Segment, unknown>>;
  carteGeographique: unknown;
  clientsARelancer: unknown;
}

/** Mode d'emploi embarqué dans le fichier — permet à un analyste (humain ou
 *  IA) de comprendre chaque section sans accès au code de l'application. */
const LISEZ_MOI = [
  "Export complet de l'onglet « Statistiques » de TeleVent (application de télévente fruits & légumes).",
  "Montants en euros (€), poids en kilogrammes (kg), pourcentages en points (marginPct = taux de marge en %). Dates au format ISO 8601, semaines au format ISO (isoYear + week).",
  "`activite.jour|semaine|mois` — cockpit commercial basé sur les BONS DE LIVRAISON (BL) : `curr` = période en cours, `prev` = même période un an avant. Champs : volume (CA BL €), caProductNet (CA produits net €), weightKg (poids), margin (marge €), marginPct (taux de marge %), marginCoverage (% de lignes dont le coût est connu), ordersCount (nb de commandes), activeClients (clients actifs), avgBasket (panier moyen €). `crm`/`crmPrev` = appels, commandes issues du CRM, taux de conversion, clients touchés. `clients`/`salespersons` = tops de la période.",
  "`activite.serieHebdomadaireVolume` — volume BL et poids par semaine ISO (courbe de l'écran 1).",
  "`rapportAnnuel.<SEGMENT>` — rapport comptable basé sur les FACTURES nettes d'avoirs, par segment client (ALL = tout, GMS = grande distribution, CHR = café/hôtel/restaurant, EXPORT, RUNGIS, MIN_RUNGIS = grossistes du MIN). `matrix` = par année, 12 mois (index 0 = janvier) avec ca, margin, weightKg, caProductNet + totaux annuels. `clients`/`suppliers`/`salespersons` = tops de l'année en cours (fournisseurs et commerciaux vides si l'export n'est pas fait par un admin).",
  "`facturationHebdomadaire.<SEGMENT>` — CA et marge facturés nets par semaine ISO depuis le 1er janvier de l'année N-1 (comparer la semaine S de N à la semaine S de N-1 : saisonnalité).",
  "`carteGeographique` — facturé des 12 derniers mois glissants par zone (département français ou pays export), segments livrés (EXPORT + GMS + CHR) : CA, marge, poids, nb de BL par zone + totaux par segment.",
  "`clientsARelancer` — clients avec jours d'appel planifiés mais sans facture depuis 30 jours (les plus anciens d'abord).",
  "`scope` (présent dans plusieurs sections) — périmètre de l'utilisateur qui a exporté : admin = données globales, sinon données limitées à son portefeuille.",
  "`meta.erreurs` — jeux de données qui n'ont pas pu être récupérés lors de cet export (sections correspondantes à null).",
] as const;

/** Construit la liste des requêtes = exactement ce que consomme /dashboard. */
function buildJobs(): Job[] {
  const jobs: Job[] = [
    { label: "Activité BL · jour",    url: "/api/pilotage/activity?g=day",   assign: (r, d) => { r.activite.jour = d; } },
    { label: "Activité BL · semaine", url: "/api/pilotage/activity?g=week",  assign: (r, d) => { r.activite.semaine = d; } },
    { label: "Activité BL · mois",    url: "/api/pilotage/activity?g=month", assign: (r, d) => { r.activite.mois = d; } },
    { label: "Activité BL · série hebdo", url: "/api/pilotage/activity/weekly", assign: (r, d) => { r.activite.serieHebdomadaireVolume = d; } },
    { label: "Carte géographique", url: "/api/pilotage/geo", assign: (r, d) => { r.carteGeographique = d; } },
    { label: "Clients à relancer", url: "/api/pilotage/actions", assign: (r, d) => { r.clientsARelancer = d; } },
  ];
  for (const { id, label } of SEGMENTS) {
    jobs.push({
      label: `Rapport annuel · ${label}`,
      url: `/api/pilotage/annual?segment=${id}`,
      assign: (r, d) => { r.rapportAnnuel[id] = d; },
    });
    jobs.push({
      label: `Facturation hebdo · ${label}`,
      url: `/api/pilotage/weekly?segment=${id}`,
      assign: (r, d) => { r.facturationHebdomadaire[id] = d; },
    });
  }
  return jobs;
}

/** Exécute les jobs avec au plus `size` requêtes simultanées (ménage le serveur). */
async function runPool(workers: (() => Promise<void>)[], size: number): Promise<void> {
  let next = 0;
  async function lane() {
    while (next < workers.length) {
      const idx = next++;
      await workers[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, workers.length) }, lane));
}

/** Déclenche le téléchargement navigateur du JSON assemblé. */
function downloadJson(payload: ExportRoot, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function StatsExportPanel() {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;

  const run = async () => {
    const jobs = buildJobs();
    setProgress({ done: 0, total: jobs.length });
    const t = toast.loading("Export des données Stats…");

    const root: ExportRoot = {
      meta: {
        titre: "Export Statistiques TeleVent — onglet Stats (/dashboard)",
        application: "TeleVent Gervi",
        source: "Miroir comptable SAP (bons de livraison, factures nettes d'avoirs) + CRM télévente",
        genereLe: new Date().toISOString(),
        lisezMoi: [...LISEZ_MOI],
        erreurs: [],
      },
      activite: { jour: null, semaine: null, mois: null, serieHebdomadaireVolume: null },
      rapportAnnuel: {},
      facturationHebdomadaire: {},
      carteGeographique: null,
      clientsARelancer: null,
    };

    try {
      await runPool(
        jobs.map((job) => async () => {
          try {
            const r = await fetch(job.url, { cache: "no-store" });
            const j = await r.json().catch(() => null);
            if (!r.ok) throw new Error((j as { error?: string } | null)?.error ?? r.statusText);
            job.assign(root, j);
          } catch (e) {
            job.assign(root, null);
            root.meta.erreurs.push({ jeu: job.label, erreur: (e as Error).message || String(e) });
          } finally {
            setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          }
        }),
        4,
      );

      const failed = root.meta.erreurs.length;
      if (failed === jobs.length) {
        toast.error("Export impossible : aucune donnée n'a pu être récupérée.", { id: t, duration: 10000 });
        return;
      }

      downloadJson(root, `televent-stats-${new Date().toISOString().slice(0, 10)}.json`);
      if (failed > 0) {
        toast.warning(
          `Fichier téléchargé, mais ${failed} jeu${failed > 1 ? "x" : ""} de données manquant${failed > 1 ? "s" : ""} (détail dans meta.erreurs).`,
          { id: t, duration: 10000 },
        );
      } else {
        toast.success("Fichier téléchargé — prêt à être analysé dans Claude.", { id: t, duration: 8000 });
      }
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-foreground">Données de l&apos;onglet Statistiques</p>
          <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">
            Rassemble tout ce qu&apos;affiche l&apos;onglet Stats — activité BL
            (jour / semaine / mois, N vs N-1), rapport annuel par segment, évolution
            hebdomadaire, carte géographique, clients à relancer — dans un seul
            fichier JSON. L&apos;export respecte vos droits d&apos;accès.
          </p>
        </div>
        <div className="shrink-0">
          <Button variant="outline" size="sm" onClick={run} disabled={busy} className="gap-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {busy && progress
              ? `Export… ${progress.done}/${progress.total}`
              : "Exporter (JSON)"}
          </Button>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground/80 rounded-lg bg-secondary/40 px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-brand-500" />
        <span>
          Le fichier est auto-documenté (section <code className="font-mono">lisezMoi</code>) :
          glissez-le tel quel dans <b>Claude</b> ou <b>Claude Cowork</b> et demandez par
          exemple « analyse ces statistiques et dégage les tendances, anomalies et
          opportunités par segment ».
        </span>
      </p>
    </div>
  );
}
