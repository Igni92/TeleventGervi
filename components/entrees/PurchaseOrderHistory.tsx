"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2, RefreshCw, PackageCheck, Search, ChevronRight, X, AlertTriangle,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FullscreenPanel } from "@/components/ui/fullscreen-panel";
import { InfoHint } from "@/components/ui/info-hint";
import { StatBlock } from "@/components/ui/stat-block";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { fmtJourDate } from "@/lib/date-fr";
import { heureFromDocRef, creatorFromDocRef } from "@/lib/docLabel";
import { eur, eur0 } from "@/lib/format";
import type { PurchaseOrder } from "./poTypes";
import { PurchaseOrderEditor } from "./PurchaseOrderEditor";

/** Date « jour + date » unifiée des états SAP : « VEN 10.07.26 ». */
const fmtDate = fmtJourDate;

/** Regroupe des documents par JOUR de commande (docDate), en conservant l'ordre
 *  d'entrée (récent → ancien). Rend « JEU 03.09 › CF… » au lieu de répéter la date
 *  sur chaque ligne. */
function groupByDay<T extends { docDate?: string | null }>(rows: T[]): { key: string; label: string; rows: T[] }[] {
  const m = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const d of rows) {
    const key = d.docDate?.slice(0, 10) || "—";
    let g = m.get(key);
    if (!g) { g = { key, label: key === "—" ? "Sans date" : fmtDate(d.docDate ?? null), rows: [] }; m.set(key, g); }
    g.rows.push(d);
  }
  return [...m.values()];
}

/** Bandeau de jour — en-tête d'un groupe (« JEU 03.09.26 · 4 »). */
function DayHeader({ label, count }: { label: string; count: number }) {
  // Groupe de JOUR clair et distinct (barre accentuée + pastille compteur).
  return (
    <div className="flex items-center gap-2 rounded-lg border-l-4 border-brand-500 bg-brand-500/[0.07] px-2.5 py-2">
      <span className="text-[13px] font-bold uppercase tracking-wide text-foreground tnum">{label}</span>
      <span className="inline-flex items-center justify-center rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:text-brand-300 tnum">{count}</span>
    </div>
  );
}

function StatusBadge({ open, cancelled, large }: { open: boolean; cancelled?: boolean; large?: boolean }) {
  const tone = cancelled
    ? "bg-rose-500/15 border border-rose-500/50 text-rose-600 dark:text-rose-400"
    : open
      ? "bg-amber-500/15 border border-amber-500/50 text-amber-600 dark:text-amber-400"
      : "bg-emerald-500/15 border border-emerald-500/50 text-emerald-600 dark:text-emerald-400";
  const label = cancelled ? "Annulée" : open ? "Ouverte" : "Clôturée";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-semibold ${large ? "px-2.5 h-7 text-[12px]" : "px-2 h-6 text-[11px]"} ${tone}`}>
      {label}
    </span>
  );
}

/** Commande ouverte dont la livraison prévue est atteinte (≤ aujourd'hui).
 *  Comparaison sur la DATE CALENDAIRE (yyyy-mm-dd) pour éviter tout décalage de
 *  fuseau : une livraison datée de demain ne doit jamais s'afficher « à réceptionner ». */
function isDue(d: { open: boolean; dueDate: string | null }): boolean {
  if (!d.open || !d.dueDate) return false;
  const dueStr = d.dueDate.slice(0, 10);                 // yyyy-mm-dd (date SAP)
  const n = new Date();
  const todayStr = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  return dueStr <= todayStr;
}

function DueBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 h-6 text-[11px] font-semibold bg-amber-500/15 border border-amber-500/60 text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3 shrink-0" /> À réceptionner
    </span>
  );
}

/** Pastille(s) « EM <n°> » de l'entrée marchandise liée — clic = ouvre l'EM
 *  (navigation vers l'écran Entrées). `stopPropagation` : ne pas ouvrir aussi la
 *  commande sous-jacente (la ligne est cliquable). Tiret atténué si aucune EM. */
function EmLinks({ ems, onOpen }: { ems?: { docEntry: number; docNum: number }[]; onOpen: (docEntry: number) => void }) {
  if (!ems || ems.length === 0) return <span className="text-muted-foreground/40 text-[12px]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ems.map((em) => (
        <button
          key={em.docEntry}
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(em.docEntry); }}
          title="Ouvrir l'entrée marchandise"
          className="inline-flex items-center gap-1 rounded-md border border-emerald-400/50 bg-emerald-500/10 px-2 h-6 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors"
        >
          EM {em.docNum}
        </button>
      ))}
    </span>
  );
}

/** Liste des COMMANDES FOURNISSEURS (SAP PurchaseOrders) — lecture seule.
 *  `restricted` = agréeur « pur » : ne voit AUCUN prix, ne peut ni modifier ni
 *  annuler la commande — seulement la consulter et la passer en entrée
 *  marchandise (« Réceptionner → EM »). */
export function PurchaseOrderHistory({ restricted = false, reloadSignal }: { restricted?: boolean; reloadSignal?: number }) {
  const [docs, setDocs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [largeEntry, setLargeEntry] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sap/purchase-orders?last=40", { cache: "no-store" });
      const json = await res.json();
      setDocs(json.docs ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Rafraîchissement piloté par le parent (après création depuis la feuille).
  useEffect(() => { if (reloadSignal) load(); }, [reloadSignal, load]);

  // Deep-link `?cf=<docEntry>` : ouvre directement la commande (venant d'un lien
  // « CF … » cliqué depuis l'écran Entrées marchandises). Best-effort : n'ouvre
  // que si la commande est dans la fenêtre chargée (dernières 40).
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const cf = searchParams.get("cf");
    if (!cf) return;
    const entry = Number(cf);
    if (Number.isInteger(entry) && docs.some((d) => d.docEntry === entry)) setLargeEntry(entry);
  }, [searchParams, docs]);

  const openEm = useCallback((docEntry: number) => {
    router.push(`/entrees?em=${docEntry}`);
  }, [router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (dateFilter && d.docDate?.slice(0, 10) !== dateFilter) return false;
      if (!q) return true;
      const haystack = [
        d.cardCode, d.cardName, d.numAtCard, `n°${d.docNum}`, String(d.docNum),
        ...d.lines.flatMap((l) => [l.itemCode, l.itemName]),
      ];
      return haystack.some((h) => (h ?? "").toString().toLowerCase().includes(q));
    });
  }, [docs, query, dateFilter]);

  const dayGroups = useMemo(() => groupByDay(filtered), [filtered]);
  const hasFilters = query.trim() !== "" || dateFilter !== "";
  const largeDoc = largeEntry != null ? docs.find((d) => d.docEntry === largeEntry) ?? null : null;
  const dueCount = useMemo(() => docs.filter(isDue).length, [docs]);

  return (
    <div className="space-y-6">
      <SurfaceCard accent="violet" className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-muted-foreground" />
            Cde Fournisseur
          </h2>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Rafraîchir
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Fournisseur, code article ou n° de commande…"
              className="pl-9"
            />
          </div>
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-auto"
            aria-label="Filtrer par date"
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setDateFilter(""); }}>
              <X className="h-3.5 w-3.5" /> Effacer
            </Button>
          )}
        </div>

        {loading && docs.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground py-2">Chargement…</p>
        )}
        {!loading && docs.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground py-2">Aucune commande fournisseur récente.</p>
        )}
        {!loading && docs.length > 0 && filtered.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground py-2">Aucune commande ne correspond à la recherche.</p>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-wrap gap-6 pb-1">
            <StatBlock label="Commandes" value={<AnimatedNumber value={filtered.length} />} />
            {!restricted && (
              <StatBlock
                label="Engagé (HT)"
                tone="emerald"
                value={
                  <AnimatedNumber
                    value={filtered.reduce((s, d) => s + (d.totalHT ?? 0), 0)}
                    format={eur0}
                  />
                }
              />
            )}
            <StatBlock label="Ouvertes" value={<AnimatedNumber value={filtered.filter((d) => d.open).length} />} />
            {dueCount > 0 && <StatBlock label="À réceptionner" tone="amber" value={dueCount} />}
          </div>
        )}

        {/* Mobile : cartes GROUPÉES PAR JOUR (bandeau JEU 03.09 › cartes) */}
        {filtered.length > 0 && (
          <div className="md:hidden space-y-4">
            {dayGroups.map((g) => (
              <div key={g.key} className="space-y-2">
                <DayHeader label={g.label} count={g.rows.length} />
                {g.rows.map((d) => {
                  const heure = heureFromDocRef(d.comments);
                  const creator = creatorFromDocRef(d.comments);
                  return (
                  <button
                    key={d.docEntry}
                    type="button"
                    onClick={() => setLargeEntry(d.docEntry)}
                    className="w-full rounded-2xl border border-border bg-card flex items-center gap-3 p-4 text-left active:bg-secondary/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-foreground truncate">
                        <span className="font-mono text-muted-foreground text-[13px]">CF {d.docNum}</span> · {d.cardName || d.cardCode}
                      </div>
                      {/* Le jour est dans le bandeau → ligne = livraison + heure/auteur. */}
                      <div className="text-[12.5px] text-muted-foreground mt-0.5 tnum">
                        Livr. {fmtDate(d.dueDate)}{heure ? ` · ${heure}` : ""}{creator ? ` · ${creator}` : ""}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {isDue(d) ? <DueBadge /> : <StatusBadge open={d.open} cancelled={d.cancelled} />}
                        <EmLinks ems={d.ems} onOpen={openEm} />
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                      {!restricted && (
                        <div>
                          <span className="font-display text-[16px] tnum text-muted-foreground leading-none">{eur(d.totalHT ?? 0)}</span>
                          <span className="ml-1 text-[11px] text-muted-foreground">HT</span>
                        </div>
                      )}
                      <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
                    </div>
                  </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Desktop : tableau */}
        {filtered.length > 0 && (
          <div className="hidden md:block rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold w-24">N° Cde</th>
                  <th className="text-left px-3 py-2 font-semibold">Fournisseur</th>
                  <th className="text-left px-3 py-2 font-semibold w-28">Livraison</th>
                  <th className="text-left px-3 py-2 font-semibold w-36">Statut</th>
                  <th className="text-left px-3 py-2 font-semibold w-40">Entrée Marchandise</th>
                  {!restricted && <th className="text-right px-3 py-2 font-semibold w-32">Total HT</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {dayGroups.map((g) => (
                  <Fragment key={g.key}>
                    {/* En-tête de JOUR — groupe clair et distinct (barre accentuée). */}
                    <tr>
                      <td colSpan={restricted ? 6 : 7} className="p-0">
                        <div className="flex items-center gap-2 border-y-2 border-brand-500/30 bg-brand-500/[0.07] px-3 py-2.5">
                          <span className="h-4 w-1 rounded-full bg-brand-500" />
                          <span className="text-[13px] font-bold uppercase tracking-wide text-foreground tnum">{g.label}</span>
                          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:text-brand-300 tnum">{g.rows.length}</span>
                        </div>
                      </td>
                    </tr>
                    {g.rows.map((d) => (
                  <tr
                    key={d.docEntry}
                    onClick={() => setLargeEntry(d.docEntry)}
                    className="border-t border-border/60 hover:bg-secondary/30 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 font-mono font-semibold">n° {d.docNum}</td>
                    <td className="px-3 py-2.5">
                      {/* Le NOM d'abord ; le technique (code SAP, date/heure de prise,
                          réf., nb lignes) derrière le « ? ». */}
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-foreground truncate text-[14px]">{d.cardName || d.cardCode}</span>
                        <InfoHint label="Détails commande" side="right">
                          <span className="block space-y-0.5">
                            <span className="block">Code SAP : <span className="font-mono">{d.cardCode}</span></span>
                            <span className="block">Commandée le {fmtDate(d.docDate)}{heureFromDocRef(d.comments) ? ` à ${heureFromDocRef(d.comments)}` : ""}</span>
                            {d.numAtCard && <span className="block">Réf. : <span className="tnum">{d.numAtCard}</span></span>}
                            <span className="block">{d.lineCount} ligne{d.lineCount > 1 ? "s" : ""}</span>
                          </span>
                        </InfoHint>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tnum text-muted-foreground">{fmtDate(d.dueDate)}</td>
                    <td className="px-3 py-2.5">{isDue(d) ? <DueBadge /> : <StatusBadge open={d.open} cancelled={d.cancelled} />}</td>
                    <td className="px-3 py-2.5"><EmLinks ems={d.ems} onOpen={openEm} /></td>
                    {!restricted && <td className="px-3 py-2.5 text-right tnum font-display font-bold text-[15px]">{eur(d.totalHT ?? 0)}</td>}
                    <td className="px-2 py-2.5 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground/50 inline" /></td>
                  </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* ── Détail PLEIN ÉCRAN (on oublie le fond) ── */}
      <FullscreenPanel
        open={!!largeDoc}
        onOpenChange={(o) => { if (!o) setLargeEntry(null); }}
        title={largeDoc?.cardName || largeDoc?.cardCode || ""}
        subtitle={
          largeDoc ? (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="font-mono">CF n° {largeDoc.docNum}</span>
              <span className="tnum">· Livraison {fmtDate(largeDoc.dueDate)}</span>
              {isDue(largeDoc) ? <DueBadge /> : <StatusBadge open={largeDoc.open} cancelled={largeDoc.cancelled} />}
            </span>
          ) : undefined
        }
        highlight={!restricted && largeDoc ? <>{eur(largeDoc.totalHT ?? 0)} <span className="text-[12px] font-sans font-medium text-muted-foreground">HT</span></> : undefined}
      >
        {largeDoc && (
          <div className="mx-auto max-w-5xl">
            <PurchaseOrderEditor
              po={largeDoc}
              restricted={restricted}
              onDone={() => { setLargeEntry(null); load(); }}
              onModified={load}
            />
          </div>
        )}
      </FullscreenPanel>
    </div>
  );
}

