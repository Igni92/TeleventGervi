"use client";

/**
 * VENTES DU JOUR — état commercial des ventes (en préparation + en livraison).
 *
 * Deux volets, adossés à GET /api/livraisons :
 *   • « En préparation »  : les BL de la PROCHAINE livraison (J+1, sauf samedi → lundi).
 *     C'est ici que le commercial « MET EN PRÉPARATION » un magasin : tant qu'il ne
 *     l'a pas fait, la commande est INVISIBLE dans le Détail livraison pour les
 *     préparateurs (filtre serveur, cf. app/api/livraisons/route.ts).
 *   • « En livraison »    : les BL dont la livraison est AUJOURD'HUI (suivi Fait/Départ).
 *
 * Les BL « avoir / exclu » ne sont pas des ventes → masqués de cet état.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, CheckCircle2, Clock, Loader2, PackageOpen, RefreshCw,
  Search, Send, Store, Truck, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { displayPersonName } from "@/lib/userNames";
import { formatDeliveryDate } from "@/lib/livraison";
import { docStatus, STATUS_LABEL, type ApiResp, type Doc, type StatusTab } from "@/lib/livraisonView";

/** Date murale Europe/Paris (le poste peut être ailleurs) — « aujourd'hui » métier. */
function parisTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const STATUS_BADGE: Record<StatusTab, string> = {
  A_PREPARER: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  FAIT: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  DEPART: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

/** Même palette de segments que le Détail livraison (SEG_UI de LivraisonDetail). */
const SEGMENT_BADGE: Record<string, string> = {
  CHR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  GMS: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
};

/** Un volet de l'état : la date livrée + les ventes À PLAT (hors « avoir / exclu »).
 *  On aplatit dès la réception — le rendu ne consomme pas l'arbre transporteurs,
 *  et les mises à jour optimistes deviennent un simple map à un niveau. */
interface Volet { date: string; docs: Doc[] }

function toVolet(data: ApiResp | null): Volet | null {
  if (!data?.ok) return null;
  return { date: data.date, docs: data.carriers.flatMap((c) => c.docs).filter((d) => !d.excluded) };
}

export function VentesDuJour() {
  const [prep, setPrep] = useState<Volet | null>(null);         // prochaine livraison (défaut API)
  const [jour, setJour] = useState<Volet | null>(null);         // livraison d'AUJOURD'HUI
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<number>>(new Set());     // docEntry en cours de bascule
  const [bulkBusy, setBulkBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rPrep, rJour] = await Promise.all([
        fetch("/api/livraisons", { cache: "no-store" }),
        fetch(`/api/livraisons?date=${parisTodayISO()}`, { cache: "no-store" }),
      ]);
      const [jPrep, jJour] = await Promise.all([
        rPrep.json().catch(() => null),
        rJour.json().catch(() => null),
      ]);
      if (jPrep?.ok) setPrep(toVolet(jPrep)); else toast.error(jPrep?.error || "Ventes en préparation indisponibles");
      if (jJour?.ok) setJour(toVolet(jJour));
    } catch {
      toast.error("SAP injoignable — ventes du jour non chargées");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pose le flag « mis en préparation » sur un jeu de BL, dans les DEUX volets
  // (un même docEntry peut être affiché des deux côtés un jour férié décalé).
  const applyFlag = useCallback((entries: number[], on: boolean) => {
    const set = new Set(entries);
    const patch = (v: Volet | null): Volet | null =>
      v && { ...v, docs: v.docs.map((d) => (set.has(d.docEntry) ? { ...d, misEnPrep: on } : d)) };
    setPrep(patch);
    setJour(patch);
  }, []);

  // Bascule « mis en préparation » — optimiste, rollback si échec.
  const toggleMiseEnPrep = useCallback(async (docEntry: number, on: boolean) => {
    setBusy((prev) => new Set(prev).add(docEntry));
    applyFlag([docEntry], on);
    try {
      const r = await fetch("/api/livraisons/mise-en-prep", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry, misEnPrep: on }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de la mise en préparation");
    } catch (e) {
      applyFlag([docEntry], !on);
      toast.error(e instanceof Error ? e.message : "Échec de la mise en préparation");
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(docEntry); return next; });
    }
  }, [applyFlag]);

  // « Tout mettre en préparation » — optimiste aussi : le seul changement est un
  // booléen déjà connu côté client, inutile de rejouer 2 pipelines SAP (load()).
  const releaseAll = useCallback(async (docs: Doc[]) => {
    const entries = docs.filter((d) => !d.misEnPrep).map((d) => d.docEntry);
    if (!entries.length) return;
    if (!window.confirm(`Mettre ${entries.length} magasin${entries.length > 1 ? "s" : ""} en préparation ? Ils deviendront visibles pour l'entrepôt.`)) return;
    setBulkBusy(true);
    applyFlag(entries, true);
    try {
      const r = await fetch("/api/livraisons/mise-en-prep", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntries: entries, misEnPrep: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de la mise en préparation groupée");
      toast.success(`${entries.length} magasin${entries.length > 1 ? "s" : ""} mis en préparation`);
    } catch (e) {
      applyFlag(entries, false);
      toast.error(e instanceof Error ? e.message : "Échec de la mise en préparation groupée");
    } finally {
      setBulkBusy(false);
    }
  }, [applyFlag]);

  const needle = q.trim().toLowerCase();
  const match = useCallback((d: Doc) =>
    !needle ||
    d.cardName.toLowerCase().includes(needle) ||
    (d.cardFullName ?? "").toLowerCase().includes(needle) ||
    String(d.docNum).includes(needle), [needle]);

  const prepDocs = useMemo(
    () => (prep?.docs ?? []).filter(match).sort((a, b) =>
      Number(a.misEnPrep ?? false) - Number(b.misEnPrep ?? false) || a.cardName.localeCompare(b.cardName, "fr")),
    [prep, match],
  );
  const jourDocs = useMemo(
    () => (jour?.docs ?? []).filter(match).sort((a, b) => a.cardName.localeCompare(b.cardName, "fr")),
    [jour, match],
  );
  const pendingCount = prepDocs.filter((d) => !d.misEnPrep).length;
  const caPrep = prepDocs.reduce((s, d) => s + d.totalHT, 0);
  const caJour = jourDocs.reduce((s, d) => s + d.totalHT, 0);

  return (
    <div className="space-y-5">
      {/* Bandeau : recherche + rafraîchissement */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par magasin ou n° de BL…"
            aria-label="Filtrer les ventes"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {/* ── Volet 1 : EN PRÉPARATION (prochaine livraison) ── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <PackageOpen className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-foreground leading-tight">
                En préparation{prep?.date ? ` — livraison du ${formatDeliveryDate(prep.date)}` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {loading && !prep ? "Chargement…" : (
                  <>
                    {prepDocs.length} vente{prepDocs.length > 1 ? "s" : ""} · {eur.format(caPrep)} HT
                    {pendingCount > 0 && <> · <b className="text-amber-600 dark:text-amber-400">{pendingCount} magasin{pendingCount > 1 ? "s" : ""} pas encore visible{pendingCount > 1 ? "s" : ""} entrepôt</b></>}
                  </>
                )}
              </p>
            </div>
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => releaseAll(prepDocs)}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[12.5px] font-semibold disabled:opacity-50 active:scale-95 transition-all"
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Tout mettre en préparation ({pendingCount})
            </button>
          )}
        </div>
        <VenteRows
          docs={prepDocs}
          loading={loading && !prep}
          busy={busy}
          emptyLabel="Aucune vente pour la prochaine livraison."
          onToggle={toggleMiseEnPrep}
        />
      </section>

      {/* ── Volet 2 : EN LIVRAISON (aujourd'hui) ── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
            <Truck className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground leading-tight">
              En livraison{jour?.date ? ` — aujourd'hui, ${formatDeliveryDate(jour.date)}` : " — aujourd'hui"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {loading && !jour
                ? "Chargement…"
                : `${jourDocs.length} vente${jourDocs.length > 1 ? "s" : ""} · ${eur.format(caJour)} HT`}
            </p>
          </div>
        </div>
        <VenteRows
          docs={jourDocs}
          loading={loading && !jour}
          busy={busy}
          emptyLabel="Aucune livraison aujourd'hui."
          onToggle={toggleMiseEnPrep}
        />
      </section>
    </div>
  );
}

/** Lignes de vente — une ligne = un BL (magasin), action « mettre en préparation ». */
function VenteRows({ docs, loading, busy, emptyLabel, onToggle }: {
  docs: Doc[];
  loading: boolean;
  busy: Set<number>;
  emptyLabel: string;
  onToggle: (docEntry: number, on: boolean) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des ventes…
      </div>
    );
  }
  if (!docs.length) {
    return <p className="px-5 py-4 text-[13px] text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-border/60">
      {docs.map((d) => {
        const status = docStatus(d);
        const isBusy = busy.has(d.docEntry);
        const takenTime = d.takenAt ? d.takenAt.slice(11, 16) : null;
        return (
          <li key={d.docEntry} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 sm:px-5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 min-w-0 text-[13.5px] font-semibold text-foreground">
                <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.cardFullName ?? d.cardName}</span>
                {d.clientType && SEGMENT_BADGE[d.clientType] && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0 ${SEGMENT_BADGE[d.clientType]}`}>
                    {d.clientType}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                <span>BL #{d.docNum}</span>
                {takenTime && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Prise {takenTime}</span>}
                <span>{d.colis.toLocaleString("fr-FR")} colis</span>
                {d.totalHT > 0 && <span>{eur.format(d.totalHT)} HT</span>}
                {d.carrierName && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {d.carrierName}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[status]}`}>
                {STATUS_LABEL[status]}
              </span>
              {d.misEnPrep ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    title={d.misEnPrepBy ? `Mis en préparation par ${displayPersonName(d.misEnPrepBy)}` : "Visible pour l'entrepôt"}
                  >
                    <CheckCircle2 className="h-3 w-3" /> En préparation
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggle(d.docEntry, false)}
                    disabled={isBusy}
                    title="Retirer de la préparation (le magasin redevient invisible pour l'entrepôt)"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onToggle(d.docEntry, true)}
                  disabled={isBusy}
                  title="Rendre ce magasin visible pour l'entrepôt (Détail livraison)"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[12px] font-semibold disabled:opacity-50 active:scale-95 transition-all"
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Mettre en préparation
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
