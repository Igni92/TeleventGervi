"use client";

/**
 * PRÉPARATIONS À FAIRE — les BL PAS ENCORE PRÉPARÉS des livraisons à venir,
 * groupés par DATE DE LIVRAISON (le plus proche en premier). Vue de charge
 * pour anticiper le travail de préparation sur plusieurs jours (au-delà du
 * seul jour du Détail livraison).
 *
 * « Pas encore préparé » = ni fait (prepared) ni parti (departed), hors avoir.
 * Adossé à GET /api/livraisons?from=…&to=… (plage de dates de livraison). Pour
 * les rôles restreints, l'API ne renvoie que les BL mis en préparation (idem
 * Détail livraison) — le préparateur voit exactement sa charge.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, ClipboardList, Loader2, RefreshCw, Search, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { addDaysISO, formatDeliveryDate } from "@/lib/livraison";
import { hasMissing, type ApiResp, type Doc } from "@/lib/livraisonView";

/** Date murale Europe/Paris — « aujourd'hui » métier. */
function parisTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Fenêtre analysée : aujourd'hui → +N jours de livraison. */
const WINDOW_DAYS = 14;

const SEGMENT_BADGE: Record<string, string> = {
  CHR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  GMS: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
};

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par magasin, transporteur, n° BL…"
            aria-label="Filtrer les préparations"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <span className="text-[12px] text-muted-foreground tnum">
          {loading && !data ? "" : `${total} à préparer`}
        </span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 px-1 py-4 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement des préparations…
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-12 px-6">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 mb-3">
            <CheckCircle2 className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <p className="text-[14px] font-semibold text-foreground">Tout est préparé</p>
          <p className="text-[12.5px] text-muted-foreground mt-1 max-w-sm">
            Aucune préparation en attente sur les {WINDOW_DAYS} prochains jours{needle ? " pour cette recherche" : ""}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.date} className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 sm:px-5 py-2.5 border-b border-border bg-secondary/30">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <ClipboardList className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-foreground leading-tight">
                    Livraison du {g.date ? capitalize(formatDeliveryDate(g.date)) : "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {g.docs.length} préparation{g.docs.length > 1 ? "s" : ""} à faire
                  </p>
                </div>
              </div>
              <ul className="divide-y divide-border/60">
                {g.docs.map((d) => (
                  <li key={d.docEntry}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openDoc(g.date, d)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDoc(g.date, d); } }}
                      title={`Ouvrir « ${d.cardFullName ?? d.cardName} » (BL n°${d.docNum}) — modifier les lots`}
                      className="flex items-center gap-2 px-4 sm:px-5 py-3 cursor-pointer select-none hover:bg-secondary/40 active:bg-secondary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 transition-colors"
                    >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 min-w-0 text-[13.5px] font-semibold text-foreground">
                        <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{d.cardFullName ?? d.cardName}</span>
                        {d.clientType && SEGMENT_BADGE[d.clientType] && (
                          <span className={`hidden xs:inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0 ${SEGMENT_BADGE[d.clientType]}`}>
                            {d.clientType}
                          </span>
                        )}
                      </p>
                      {/* Ligne méta : sur le plus étroit (iPhone zoomé) on garde
                          l'essentiel — n° BL, transporteur, alerte manquants. Le
                          nombre de colis ne réapparaît qu'à partir de `xs`. */}
                      <p className="text-[11px] text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5">
                        <span>BL # {d.docNum}</span>
                        <span className="inline-flex items-center gap-1 min-w-0"><Truck className="h-3 w-3 shrink-0" /> <span className="truncate">{d.carrierName ?? "Non affecté"}</span></span>
                        <span className="hidden xs:inline">{d.colis.toLocaleString("fr-FR")} colis</span>
                        {hasMissing(d) && (
                          <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                            {(d.missingItems?.length ?? 0)} manquant{(d.missingItems?.length ?? 0) > 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                    </div>
                    {/* Pastille de statut : redondante sur mobile (toute la section
                        est « à préparer » + thème ambre) → réservée à ≥ sm pour
                        laisser respirer le nom du magasin sur téléphone. */}
                    <span className="hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0">
                      À préparer
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
