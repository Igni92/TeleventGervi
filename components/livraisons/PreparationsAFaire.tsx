"use client";

/**
 * PRÉPARATIONS À FAIRE — les BL PAS ENCORE PRÉPARÉS des livraisons à venir,
 * groupés par DATE DE LIVRAISON (le plus proche en premier). Vue de CHARGE
 * pour anticiper le travail de préparation sur plusieurs jours (au-delà du
 * seul jour du Détail livraison) : chaque jour affiche ses totaux
 * (n BL · colis · kg).
 *
 * « Pas encore préparé » = ni fait (prepared) ni parti (departed), hors avoir.
 * Adossé à GET /api/livraisons?from=…&to=… (plage de dates de livraison). Pour
 * les rôles restreints, l'API ne renvoie que les BL mis en préparation (idem
 * Détail livraison) — le préparateur voit exactement sa charge.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, RefreshCw, Search, Truck } from "lucide-react";
import { toast } from "sonner";
import { addDaysISO, formatDeliveryDate } from "@/lib/livraison";
// Couleurs de segment : source unique du design system (GMS teal · CHR amber · EXPORT violet).
import { segmentBadgeClass } from "@/lib/segments";
import { hasMissing, type ApiResp, type Doc } from "@/lib/livraisonView";
import { GroupedList, GroupedRow } from "@/components/ui/grouped-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

/** Date murale Europe/Paris — « aujourd'hui » métier. */
function parisTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Fenêtre analysée : aujourd'hui → +N jours de livraison. */
const WINDOW_DAYS = 14;

const NF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

interface DayGroup { date: string; docs: Doc[] }

/** BL non préparés (ni fait ni parti, hors avoir), groupés par date de livraison. */
function toDayGroups(data: ApiResp | null): DayGroup[] {
  if (!data?.ok) return [];
  const todo = data.carriers
    .flatMap((c) => c.docs)
    .filter((d) => !d.excluded && !d.prepared && !d.departed);
  const byDate = new Map<string, Doc[]>();
  for (const d of todo) {
    const key = (d.dueDate || "").slice(0, 10);
    (byDate.get(key) ?? byDate.set(key, []).get(key)!).push(d);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, docs]) => ({
      date,
      docs: docs.sort((a, b) => (a.carrierName ?? "~").localeCompare(b.carrierName ?? "~", "fr") || a.cardName.localeCompare(b.cardName, "fr")),
    }));
}

export function PreparationsAFaire() {
  const router = useRouter();
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const today = useMemo(() => parisTodayISO(), []);

  // Ouvrir une commande = filer vers « Livraisons du jour » à la bonne date, la
  // commande cible ouverte directement (vue en grand → console de lot). Le nonce
  // `t` change à chaque clic pour ROUVRIR la même commande (« si je rentre encore
  // dedans, rouvrir la console »).
  const openDoc = useCallback((groupDate: string, d: Doc) => {
    const date = (d.dueDate || groupDate || "").slice(0, 10);
    router.push(`/livraisons?date=${date}&open=${d.docEntry}&t=${Date.now()}`);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const to = addDaysISO(today, WINDOW_DAYS);
      const r = await fetch(`/api/livraisons?from=${today}&to=${to}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) setData(j); else toast.error(j?.error || "Préparations indisponibles");
    } catch {
      toast.error("SAP injoignable — préparations non chargées");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const base = toDayGroups(data);
    if (!needle) return base;
    return base
      .map((g) => ({ ...g, docs: g.docs.filter((d) =>
        d.cardName.toLowerCase().includes(needle) ||
        (d.cardFullName ?? "").toLowerCase().includes(needle) ||
        (d.carrierName ?? "").toLowerCase().includes(needle) ||
        String(d.docNum).includes(needle)) }))
      .filter((g) => g.docs.length > 0);
  }, [data, needle]);

  const total = useMemo(() => groups.reduce((s, g) => s + g.docs.length, 0), [groups]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par magasin, transporteur, n° BL…"
            aria-label="Filtrer les préparations"
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-body focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <span className="tnum text-caption text-muted-foreground">
          {loading && !data ? "" : `${total} à préparer`}
        </span>
        <Button variant="outline" size="lg" onClick={load} disabled={loading} className="ml-auto shrink-0">
          <RefreshCw className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
      </div>

      {loading && !data ? (
        // Squelette standard : un groupe-jour factice (en-tête + 4 rangées).
        <div role="status" aria-label="Chargement des préparations">
          <Skeleton className="mb-2 ml-4 h-3.5 w-48" />
          <div className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Tout est préparé"
          description={<>Aucune préparation en attente sur les {WINDOW_DAYS} prochains jours{needle ? " pour cette recherche" : ""}.</>}
          className="rounded-xl bg-card ring-1 ring-border"
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            // Totaux du jour — c'est une vue de charge : n BL · colis · kg.
            const colis = g.docs.reduce((s, d) => s + (d.colis || 0), 0);
            const kg = g.docs.reduce((s, d) => s + (d.weightKg || 0), 0);
            return (
              <section key={g.date} aria-label={`Livraison du ${formatDeliveryDate(g.date)}`}>
                {/* En-tête de section AU-DESSUS de la surface (motif GroupedList),
                    toujours visible (pas .kicker : masqué sur mobile). */}
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4">
                  <h2 className="text-body font-semibold text-foreground">
                    {g.date ? capitalize(formatDeliveryDate(g.date)) : "—"}
                  </h2>
                  <p className="tnum text-caption text-muted-foreground">
                    {g.docs.length} BL · {NF.format(colis)} colis · {NF.format(kg)} kg
                  </p>
                </div>
                <GroupedList>
                  {g.docs.map((d) => {
                    const missing = hasMissing(d) ? (d.missingItems?.length ?? 0) : 0;
                    return (
                      <GroupedRow key={d.docEntry} onClick={() => openDoc(g.date, d)} className="py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-body font-medium text-foreground">
                              {d.cardFullName ?? d.cardName}
                            </span>
                            {d.clientType && (
                              <span className={`hidden shrink-0 items-center rounded px-1.5 py-px text-caption2 font-semibold uppercase tracking-wide xs:inline-flex ${segmentBadgeClass(d.clientType)}`}>
                                {d.clientType}
                              </span>
                            )}
                          </span>
                          {/* Méta : n° BL, transporteur, colis (masqué sur le plus
                              étroit) — rouge UNIQUEMENT s'il y a des manquants. */}
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
                            <span className="tnum">BL n° {d.docNum}</span>
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <Truck size={12} aria-hidden className="shrink-0" />
                              <span className="truncate">{d.carrierName ?? "Non affecté"}</span>
                            </span>
                            <span className="tnum hidden xs:inline">{NF.format(d.colis)} colis</span>
                            {missing > 0 && (
                              <span className="font-semibold text-destructive">
                                {missing} manquant{missing > 1 ? "s" : ""}
                              </span>
                            )}
                          </span>
                        </span>
                      </GroupedRow>
                    );
                  })}
                </GroupedList>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
