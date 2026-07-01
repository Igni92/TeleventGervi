"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Truck, Boxes, Scale, Users, FileText, Receipt,
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, AlertTriangle,
  RefreshCw, Loader2, PackageX, CheckCircle2, Clock, RotateCcw, Pencil,
  Maximize2, UserCheck, Undo2, ListChecks, UserCog, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClientLink } from "@/components/ClientLink";
import { DesignationChips } from "@/components/entrees/DesignationChips";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrandLogos } from "@/lib/useBrandLogos";
import { displayPersonName } from "@/lib/userNames";
import { broadcastActiveClient } from "@/lib/consoleSync";
import {
  nextDeliveryDate, frenchHolidayLabel, nextWorkingDeliveryDay,
  formatDeliveryDate, addDaysISO,
} from "@/lib/livraison";

interface CarrierOption { name: string; sapValue: string }
interface Tournee { lineId: number; nom: string; des: string; heure: string | null }

/* ─────────────────────────────────────────────────────────────
   Types (miroir de /api/livraisons)
───────────────────────────────────────────────────────────── */
interface Line {
  itemCode: string;
  itemName: string;
  quantity: number;
  colis: number;
  weightKg: number;
  warehouse: string | null;
  marque?: string | null;
  condt?: string | null;
  pays?: string | null;
}
interface Doc {
  docEntry: number;
  docNum: number;
  docDate: string;
  dueDate: string;
  cardCode: string;
  cardName: string;
  totalHT: number;
  totalTTC: number;
  colis: number;
  weightKg: number;
  open: boolean;
  comments: string;
  numAtCard: string;
  trspCode: string | null;
  trspHeure: string | null;
  savedTournee: { trspCode: string; heure: string | null; nom?: string | null; des?: string | null; lineId?: number | null } | null;
  carrierName: string | null;
  clientType: string | null;   // GMS | CHR | EXPORT | null
  prepared: boolean;           // « faite » — coché manuellement
  preparedBy?: string | null;  // qui a marqué la commande « faite »
  departed?: boolean;          // « départ » — partie en livraison
  departedBy?: string | null;  // qui a marqué le « départ »
  preparer?: string | null;    // préparateur affecté (qui a ouvert la commande)
  incomplete?: boolean;        // « à reprendre » — remise sur la file (pas finie)
  excluded: boolean;           // « avoir / exclu » — déduit 100% des totaux
  lineCount: number;
  lines: Line[];
}
interface Carrier {
  code: string | null;
  name: string;
  orders: number;
  colis: number;
  weightKg: number;
  totalHT: number;
  docs: Doc[];
}
interface Totals {
  orders: number;
  clients: number;
  colis: number;
  weightKg: number;
  totalHT: number;
}
interface ApiResp {
  ok: boolean;
  db?: string;
  date: string;
  holiday: string | null;
  count: number;
  totals: Totals;
  carriers: Carrier[];
  error?: string;
}

/* ─────────────────────────────────────────────────────────────
   Formatters
───────────────────────────────────────────────────────────── */
const fmtInt = (v: number) => new Intl.NumberFormat("fr-FR").format(Math.round(v));
const fmtNum = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);
const fmtKg = (v: number) => `${fmtNum(v)} kg`;
const fmtEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ─────────────────────────────────────────────────────────────
   Onglet d'état — À préparer / Fait / Départ (progression)
───────────────────────────────────────────────────────────── */
type StatusTab = "A_PREPARER" | "FAIT" | "DEPART";

/** État courant d'une commande (mutuellement exclusif) : parti > préparé > à préparer. */
function docStatus(d: { prepared: boolean; departed?: boolean }): StatusTab {
  if (d.departed) return "DEPART";
  if (d.prepared) return "FAIT";
  return "A_PREPARER";
}

/** Badge de ligne par segment client (conservé pour CHR / EXPORT, le tag GMS
 *  n'étant plus affiché — la distinction utile est désormais À préparer / Fait). */
const SEG_UI: Record<"CHR" | "EXPORT", { label: string; badge: string }> = {
  CHR:    { label: "CHR",    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  EXPORT: { label: "Export", badge: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" },
};

/* ═════════════════════════════════════════════════════════════
   Composant principal
═════════════════════════════════════════════════════════════ */
export function LivraisonDetail({ canDispatch }: { canDispatch: boolean }) {
  const [date, setDate] = useState<string>(() => nextDeliveryDate());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  // Tournées par transporteur (SERGTRS), chargées à la demande quand on ouvre le
  // sélecteur de tournée d'une commande. Cache mémoire + dédup des fetchs.
  const [tourneesByCode, setTourneesByCode] = useState<Record<string, Tournee[]>>({});
  const tourneesLoading = useRef<Set<string>>(new Set());

  // Catalogue des transporteurs (SERGTRS) pour le changement direct par commande.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/transporteurs")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok) return;
        // Libellé = le CODE transporteur (ce que l'utilisateur connaît : « ANTOINE »,
        // « DELANCHY FT86 ») et ce qui est stocké dans U_TrspCode — pas la raison
        // sociale SERGTRS (ex. « SOFRIPA » pour ANTOINE), qui prêtait à confusion.
        const opts: CarrierOption[] = (j.transporteurs ?? [])
          .filter((t: { code?: string | null }) => t.code)
          .map((t: { name: string; code: string }) => ({ name: t.code, sapValue: t.code }));
        setCarriers(opts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Charge (une fois) les tournées d'un transporteur pour peupler le sélecteur.
  const loadTournees = useCallback(async (code: string) => {
    const key = code.trim().toUpperCase();
    if (!key || tourneesByCode[key] || tourneesLoading.current.has(key)) return;
    tourneesLoading.current.add(key);
    try {
      const r = await fetch(`/api/transporteurs?code=${encodeURIComponent(code)}`);
      const j = await r.json().catch(() => null);
      if (j?.ok && j.transporteur) {
        setTourneesByCode((prev) => ({ ...prev, [key]: j.transporteur.tournees ?? [] }));
      }
    } catch { /* ignore */ } finally {
      tourneesLoading.current.delete(key);
    }
  }, [tourneesByCode]);

  const auto = useMemo(() => nextDeliveryDate(), []);
  const holiday = frenchHolidayLabel(date);
  const isAuto = date === auto;

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      fetch(`/api/livraisons?date=${date}`, { cache: "no-store", signal })
        .then(async (r) => {
          const j: ApiResp = await r.json();
          if (signal?.aborted) return;
          if (!j.ok) {
            setError(j.error || "Erreur de chargement.");
            setData(null);
          } else {
            setData(j);
          }
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("SAP injoignable. Réessayez.");
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [date],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const shift = (days: number) => setDate((d) => addDaysISO(d, days));

  // Changement de transporteur d'une commande (écrit ORDR.U_TrspCode dans SAP),
  // puis rechargement pour re-grouper. "" = désaffecter.
  const changeCarrier = useCallback(
    async (docEntry: number, sapValue: string): Promise<boolean> => {
      try {
        // Changer de transporteur réinitialise la tournée (heure) : elle dépend du
        // transporteur. On envoie trspHeure:"" → le serveur vide U_TrspHeur et
        // re-résout U_Timbre pour le nouveau transporteur.
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trspCode: sapValue, trspHeure: "" }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de transporteur");
          return false;
        }
        toast.success(sapValue ? "Transporteur mis à jour — choisis la tournée" : "Transporteur retiré");
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — transporteur non modifié");
        return false;
      }
    },
    [load],
  );

  // Changement de TOURNÉE d'une commande → pose U_TrspHeur (heure de la tournée)
  // et re-confirme le transporteur (le serveur re-résout U_Timbre). "" = aucune.
  const changeTournee = useCallback(
    async (docEntry: number, trspCode: string, tournee: Tournee | null): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trspCode,
            trspHeure: tournee?.heure ?? "",
            // Détails mémorisés pour ce client (ré-appliqués aux prochains BL).
            tournee: tournee ? { nom: tournee.nom, des: tournee.des, lineId: tournee.lineId } : undefined,
          }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de tournée");
          return false;
        }
        toast.success(tournee?.heure
          ? `Tournée : ${tournee.nom || tournee.heure.slice(0, 5)} — mémorisée pour ce client`
          : "Tournée retirée");
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — tournée non modifiée");
        return false;
      }
    },
    [load],
  );

  // Changement de DATE DE LIVRAISON d'une commande (écrit ORDR.DocDueDate), puis
  // rechargement (la commande quitte la vue si elle change de jour).
  const changeDate = useCallback(
    async (docEntry: number, dueDate: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de date");
          return false;
        }
        toast.success(`Livraison déplacée au ${formatDeliveryDate(dueDate)}`);
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — date non modifiée");
        return false;
      }
    },
    [load],
  );

  // ── Onglet d'état : « À préparer » (par défaut) / « Fait » ──
  const [statusTab, setStatusTab] = useState<StatusTab>("A_PREPARER");

  // Mise à jour optimiste d'UNE commande dans `data` (statut « faite », auteur,
  // « à reprendre »…) → la carte change d'onglet sans recharger toute la liste.
  const patchDoc = useCallback((docEntry: number, patch: Partial<Doc>) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            carriers: prev.carriers.map((c) => ({
              ...c,
              docs: c.docs.map((d) => (d.docEntry === docEntry ? { ...d, ...patch } : d)),
            })),
          }
        : prev,
    );
  }, []);

  // ── Repliage des groupes transporteur (clé = code transporteur) ──
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Comptes par état (sur l'ensemble, pour les compteurs des onglets).
  const statusCounts = useMemo(() => {
    let aPreparer = 0, fait = 0, depart = 0;
    if (data) for (const car of data.carriers) for (const d of car.docs) {
      const s = docStatus(d);
      if (s === "DEPART") depart++; else if (s === "FAIT") fait++; else aPreparer++;
    }
    return { aPreparer, fait, depart };
  }, [data]);

  // Vue filtrée par onglet (À préparer / Fait / Départ) : on recoupe les commandes
  // et on recalcule les métriques (groupes + bandeau de synthèse) pour rester cohérent.
  const view = useMemo(() => {
    if (!data) return null;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const carriers = data.carriers
      .map((c) => {
        const docs = c.docs.filter((d) => docStatus(d) === statusTab);
        return {
          ...c, docs,
          orders: docs.length,
          colis: r1(docs.reduce((s, d) => s + d.colis, 0)),
          weightKg: r1(docs.reduce((s, d) => s + d.weightKg, 0)),
          totalHT: r2(docs.reduce((s, d) => s + d.totalHT, 0)),
        };
      })
      .filter((c) => c.docs.length > 0);
    const allDocs = carriers.flatMap((c) => c.docs);
    const totals: Totals = {
      orders: allDocs.length,
      clients: new Set(allDocs.map((d) => d.cardCode)).size,
      colis: r1(allDocs.reduce((s, d) => s + d.colis, 0)),
      weightKg: r1(allDocs.reduce((s, d) => s + d.weightKg, 0)),
      totalHT: r2(allDocs.reduce((s, d) => s + d.totalHT, 0)),
    };
    return { ...data, carriers, totals, count: allDocs.length };
  }, [data, statusTab]);

  const allKeys = useMemo(() => (view?.carriers ?? []).map((c) => c.code ?? "__none__"), [view]);
  const allCollapsed = allKeys.length > 0 && allKeys.every((k) => collapsed.has(k));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(allKeys));

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── En-tête ── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1.5">Télévente · logistique</p>
          <h1 className="font-display text-[28px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
            Détail livraison
          </h1>
          <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
            Toutes les commandes à préparer pour la prochaine tournée
            (<b>J+1</b>, sauf le samedi → <b>J+2</b>). En cas de jour férié, ajustez la
            date de livraison ci-dessous.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </header>

      {/* ── Sélecteur de jour de livraison (pièce maîtresse) ── */}
      <DatePanel
        date={date}
        isAuto={isAuto}
        holiday={holiday}
        onShift={shift}
        onPick={setDate}
        onReset={() => setDate(auto)}
        onReport={() => setDate(nextWorkingDeliveryDay(date))}
      />

      {/* ── Bandeau de synthèse (reflète l'onglet À préparer / Fait) ── */}
      {view?.totals && <SummaryRow totals={view.totals} loading={loading} />}

      {/* ── Onglets À préparer / Fait + repliage global ── */}
      {data && data.count > 0 && (
        <StatusTabs
          tab={statusTab}
          counts={statusCounts}
          onPick={setStatusTab}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
        />
      )}

      {/* ── Contenu ── */}
      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-300/60 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-900/15 px-5 py-4">
          <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-rose-700 dark:text-rose-300">{error}</p>
            <button onClick={() => load()} className="text-[12px] text-rose-600 dark:text-rose-400 hover:underline mt-0.5">
              Réessayer
            </button>
          </div>
        </div>
      ) : loading && !data ? (
        <LoadingState />
      ) : data && data.count === 0 ? (
        <EmptyState date={date} />
      ) : view && view.count === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-12 px-6">
          {statusTab === "A_PREPARER" ? (
            <>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 mb-3">
                <CheckCircle2 className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-semibold text-foreground">Tout est préparé</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Aucune commande en attente de préparation.
                <button onClick={() => setStatusTab("FAIT")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir les commandes faites</button>
              </p>
            </>
          ) : statusTab === "FAIT" ? (
            <>
              <p className="text-[14px] font-semibold text-foreground">Aucune commande préparée</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Rien n&apos;a encore été marqué « fait ».
                <button onClick={() => setStatusTab("A_PREPARER")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir à préparer</button>
              </p>
            </>
          ) : (
            <>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-600 dark:text-sky-400 mb-3">
                <Truck className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-semibold text-foreground">Aucune commande partie</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Aucune livraison n&apos;a encore quitté l&apos;entrepôt.
                <button onClick={() => setStatusTab("FAIT")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir les commandes faites</button>
              </p>
            </>
          )}
        </div>
      ) : view ? (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {view.carriers.map((c) => {
            const key = c.code ?? "__none__";
            return (
              <CarrierGroup
                key={key} carrier={c} carriers={carriers} onCarrierChange={changeCarrier} onDateChange={changeDate}
                tourneesByCode={tourneesByCode} onLoadTournees={loadTournees} onTourneeChange={changeTournee}
                collapsed={collapsed.has(key)} onToggleCollapse={() => toggleCollapse(key)}
                onPatchDoc={patchDoc} onReload={() => load()} canDispatch={canDispatch}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Sélecteur de date — grand, lisible, avec garde-fou jour férié
═════════════════════════════════════════════════════════════ */
function DatePanel({
  date, isAuto, holiday, onShift, onPick, onReset, onReport,
}: {
  date: string;
  isAuto: boolean;
  holiday: string | null;
  onShift: (days: number) => void;
  onPick: (iso: string) => void;
  onReset: () => void;
  onReport: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5">
        {/* Identité du jour livré */}
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <span className="hidden sm:inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-500/5 text-brand-600 dark:text-brand-400">
            <Truck className="h-6 w-6" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                Livraison du
              </span>
              {isAuto ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/12 text-brand-600 dark:text-brand-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  <Clock className="h-3 w-3" /> Prochaine
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  Date choisie
                </span>
              )}
            </div>
            <p className="text-[20px] sm:text-[23px] font-semibold tracking-tight text-foreground leading-tight mt-0.5 truncate">
              {capitalize(formatDeliveryDate(date))}
            </p>
          </div>
        </div>

        {/* Contrôles */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button" onClick={() => onShift(-1)} aria-label="Jour précédent"
            className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <label className="relative inline-flex items-center">
            <CalendarDays className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && onPick(e.target.value)}
              className="h-11 rounded-xl border border-border bg-background pl-9 pr-3 text-[13.5px] font-medium text-foreground tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </label>
          <button
            type="button" onClick={() => onShift(1)} aria-label="Jour suivant"
            className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          {!isAuto && (
            <button
              type="button" onClick={onReset} title="Revenir à la prochaine livraison"
              className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 hover:bg-secondary/60 active:scale-95 transition-colors"
            >
              <RotateCcw className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>

      {/* Garde-fou jour férié */}
      {holiday && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-t border-amber-300/50 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-900/15 px-4 sm:px-5 py-3">
          <p className="inline-flex items-center gap-2 text-[12.5px] font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <b>{holiday}</b> — jour férié, pas de livraison. Choisissez le jour de livraison réel.
            </span>
          </p>
          <button
            type="button"
            onClick={onReport}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 active:scale-95 transition-colors shrink-0 self-start sm:self-auto"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            Reporter au prochain jour ouvré
          </button>
        </div>
      )}
    </section>
  );
}

/* ═════════════════════════════════════════════════════════════
   Bandeau de synthèse — chiffres clés de la tournée
═════════════════════════════════════════════════════════════ */
function SummaryRow({ totals, loading }: { totals: Totals; loading: boolean }) {
  const stats = [
    { icon: FileText, label: "Commandes", value: fmtInt(totals.orders), accent: "text-brand-600 dark:text-brand-400" },
    { icon: Users, label: "Clients", value: fmtInt(totals.clients), accent: "text-sky-600 dark:text-sky-400" },
    { icon: Boxes, label: "Colis", value: fmtNum(totals.colis), accent: "text-violet-600 dark:text-violet-400", hero: true },
    { icon: Scale, label: "Poids net", value: fmtKg(totals.weightKg), accent: "text-emerald-600 dark:text-emerald-400" },
    { icon: Receipt, label: "Total HT", value: fmtEur(totals.totalHT), accent: "text-amber-600 dark:text-amber-400" },
  ];
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 transition-opacity ${loading ? "opacity-60" : ""}`}>
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className={`rounded-xl border border-border bg-card p-3.5 ${s.hero ? "ring-1 ring-violet-500/20" : ""}`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`h-3.5 w-3.5 ${s.accent}`} strokeWidth={2} />
              <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                {s.label}
              </span>
            </div>
            <p className="text-[22px] font-bold tnum text-foreground leading-none">{s.value}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Groupe transporteur — en-tête + cartes clients
═════════════════════════════════════════════════════════════ */
function CarrierGroup({
  carrier, carriers, onCarrierChange, onDateChange,
  tourneesByCode, onLoadTournees, onTourneeChange,
  collapsed, onToggleCollapse, onPatchDoc, onReload, canDispatch,
}: {
  carrier: Carrier;
  carriers: CarrierOption[];
  onCarrierChange: (docEntry: number, sapValue: string) => Promise<boolean>;
  onDateChange: (docEntry: number, dueDate: string) => Promise<boolean>;
  tourneesByCode: Record<string, Tournee[]>;
  onLoadTournees: (code: string) => void;
  onTourneeChange: (docEntry: number, trspCode: string, tournee: Tournee | null) => Promise<boolean>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onPatchDoc: (docEntry: number, patch: Partial<Doc>) => void;
  onReload: () => void;
  canDispatch: boolean;
}) {
  const unassigned = !carrier.code;
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* En-tête transporteur — cliquable pour replier/déplier le groupe */}
      <div
        role="button" tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleCollapse(); } }}
        aria-expanded={!collapsed}
        title={collapsed ? "Déplier ce transporteur" : "Replier ce transporteur"}
        className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30 hover:bg-secondary/50 cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`} />
          <span
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              unassigned
                ? "bg-muted text-muted-foreground"
                : "bg-brand-500/12 text-brand-600 dark:text-brand-400"
            }`}
          >
            <Truck className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground leading-none">
              Transporteur
            </p>
            <p className={`text-[15px] font-semibold leading-tight mt-0.5 truncate ${unassigned ? "text-muted-foreground italic" : "text-foreground"}`}>
              {carrier.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6 sm:gap-8 shrink-0 text-right">
          <Metric label="Cmd." value={fmtInt(carrier.orders)} />
          <Metric label="Colis" value={fmtNum(carrier.colis)} />
          <Metric label="kg" value={fmtNum(carrier.weightKg)} className="hidden sm:block" />
        </div>
      </div>

      {/* Cartes clients (masquées si le groupe est replié) */}
      {!collapsed && (
        <ul className="divide-y divide-border/60">
          {carrier.docs.map((d) => (
            <OrderRow
              key={d.docEntry} doc={d} carriers={carriers}
              onCarrierChange={onCarrierChange} onDateChange={onDateChange}
              tournees={d.trspCode ? tourneesByCode[d.trspCode.toUpperCase()] : undefined}
              onLoadTournees={onLoadTournees} onTourneeChange={onTourneeChange}
              onPatchDoc={onPatchDoc} onReload={onReload} canDispatch={canDispatch}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ═════════════════════════════════════════════════════════════
   Onglets d'état — À préparer / Fait + repliage global
═════════════════════════════════════════════════════════════ */
function StatusTabs({
  tab, counts, onPick, allCollapsed, onToggleAll,
}: {
  tab: StatusTab;
  counts: { aPreparer: number; fait: number; depart: number };
  onPick: (t: StatusTab) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}) {
  const tabs: { key: StatusTab; label: string; count: number; icon: typeof Clock; active: string }[] = [
    { key: "A_PREPARER", label: "À préparer", count: counts.aPreparer, icon: Clock,        active: "bg-amber-500 text-white border-amber-500" },
    { key: "FAIT",       label: "Fait",       count: counts.fait,      icon: CheckCircle2, active: "bg-emerald-500 text-white border-emerald-500" },
    { key: "DEPART",     label: "Départ",     count: counts.depart,    icon: Truck,        active: "bg-sky-500 text-white border-sky-500" },
  ];
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t.key)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                isActive ? t.active : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              {t.label}
              <span className={`tnum text-[11px] font-bold ${isActive ? "opacity-90" : "opacity-60"}`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleAll}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${allCollapsed ? "-rotate-90" : ""}`} />
        {allCollapsed ? "Tout déplier" : "Tout replier"}
      </button>
    </div>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`min-w-[42px] text-right ${className ?? ""}`}>
      <p className="text-[15px] font-bold tnum leading-none text-foreground">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Ligne commande — repliable vers le détail des lignes
═════════════════════════════════════════════════════════════ */
function OrderRow({
  doc, carriers, onCarrierChange, onDateChange, tournees, onLoadTournees, onTourneeChange, onPatchDoc, onReload, canDispatch,
}: {
  doc: Doc;
  carriers: CarrierOption[];
  onCarrierChange: (docEntry: number, sapValue: string) => Promise<boolean>;
  onDateChange: (docEntry: number, dueDate: string) => Promise<boolean>;
  tournees: Tournee[] | undefined;
  onLoadTournees: (code: string) => void;
  onTourneeChange: (docEntry: number, trspCode: string, tournee: Tournee | null) => Promise<boolean>;
  onPatchDoc: (docEntry: number, patch: Partial<Doc>) => void;
  onReload: () => void;
  canDispatch: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [savingCarrier, setSavingCarrier] = useState(false);
  const [savingTournee, setSavingTournee] = useState(false);
  const brandLogos = useBrandLogos("livraison");

  // Charge les tournées du transporteur courant (une fois) pour le sélecteur.
  useEffect(() => {
    if (doc.open && doc.trspCode) onLoadTournees(doc.trspCode);
  }, [doc.open, doc.trspCode, onLoadTournees]);

  // Tournée pré-sélectionnée (par LineId, pour désambiguïser les heures égales) :
  // la tournée MÉMORISÉE du client d'abord, sinon la 1re qui correspond à l'heure
  // portée par le BL (U_TrspHeur).
  const selectedTourneeId = useMemo(() => {
    const list = tournees ?? [];
    const saved = doc.savedTournee;
    if (saved && saved.trspCode === doc.trspCode) {
      // par LineId (mémoire app), sinon par NOM de tournée (SERG_TRCL U_DistBy =
      // SERGTRS U_Nom), sinon par heure — dans cet ordre de fiabilité.
      if (saved.lineId != null && list.some((t) => t.lineId === saved.lineId)) return String(saved.lineId);
      if (saved.nom) {
        const byNom = list.find((t) => t.nom && t.nom.toUpperCase() === saved.nom!.toUpperCase());
        if (byNom) return String(byNom.lineId);
      }
      if (saved.heure) {
        const byH = list.find((t) => t.heure === saved.heure);
        if (byH) return String(byH.lineId);
      }
    }
    if (doc.trspHeure) {
      const m = list.find((t) => t.heure === doc.trspHeure);
      if (m) return String(m.lineId);
    }
    return "";
  }, [tournees, doc.savedTournee, doc.trspCode, doc.trspHeure]);

  async function handleTournee(lineIdStr: string) {
    if (!doc.trspCode || lineIdStr === selectedTourneeId) return;
    const t = (tournees ?? []).find((x) => String(x.lineId) === lineIdStr) ?? null;
    setSavingTournee(true);
    await onTourneeChange(doc.docEntry, doc.trspCode, t);
    setSavingTournee(false);
  }

  // Date de livraison (DocDueDate) — modifiable directement sur la ligne. Au
  // changement → PATCH + rechargement (la commande quitte la vue si elle bouge).
  const dueISO = (doc.dueDate ?? "").slice(0, 10);
  const [savingDate, setSavingDate] = useState(false);
  async function handleDate(value: string) {
    if (!value || value === dueISO) return;
    setSavingDate(true);
    await onDateChange(doc.docEntry, value);
    setSavingDate(false);
  }

  // N° de commande (réf. client) — éditable directement sur la ligne. Sauvé sur
  // blur/Entrée (PATCH NumAtCard) seulement si modifié. `savedRef` = dernière
  // valeur enregistrée (évite de muter la prop `doc` et les ré-enregistrements).
  const [refDraft, setRefDraft] = useState(doc.numAtCard ?? "");
  const [savedRef, setSavedRef] = useState(doc.numAtCard ?? "");
  const [savingRef, setSavingRef] = useState(false);
  async function saveRef() {
    const val = refDraft.trim();
    if (val === savedRef.trim()) return;   // inchangé
    setSavingRef(true);
    try {
      const res = await fetch(`/api/sap/orders/${doc.docEntry}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numAtCard: val }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement du n° de commande");
        setRefDraft(savedRef);   // rollback affichage
        return;
      }
      setSavedRef(val);
      toast.success(val ? `N° de commande enregistré (#${doc.docNum})` : `N° de commande retiré (#${doc.docNum})`);
    } catch {
      toast.error("SAP injoignable — n° de commande non enregistré");
      setRefDraft(savedRef);
    } finally {
      setSavingRef(false);
    }
  }

  // Statut « faite » (préparée) — MANUEL, basculé directement ici. Optimiste +
  // persistance par DocEntry (aucune déduction auto depuis l'inventaire).
  const [prepared, setPrepared] = useState(doc.prepared);
  const [savingPrep, setSavingPrep] = useState(false);
  // Préparateur affecté + auteur du « fait » + signalement « à reprendre » + vue en grand.
  const [preparer, setPreparer] = useState<string | null>(doc.preparer ?? null);
  const [preparedBy, setPreparedBy] = useState<string | null>(doc.preparedBy ?? null);
  const [incomplete, setIncomplete] = useState<boolean>(!!doc.incomplete);
  const [bigOpen, setBigOpen] = useState(false);
  const [requeuing, setRequeuing] = useState(false);
  // Vérification avant de marquer « faite » (évite les validations par erreur).
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function setPreparedTo(next: boolean) {
    setPrepared(next);
    if (next) setIncomplete(false);
    // Optimiste : la carte change d'onglet (À préparer ↔ Fait) immédiatement.
    onPatchDoc(doc.docEntry, { prepared: next, ...(next ? { incomplete: false } : {}) });
    setSavingPrep(true);
    try {
      const res = await fetch("/api/livraisons/prepared", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, prepared: next }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        setPrepared(!next);
        onPatchDoc(doc.docEntry, { prepared: !next });
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement");
        return;
      }
      // Auteur du « fait » (« Fait par … ») renvoyé par l'API.
      const by = next ? (j?.by ?? null) : null;
      setPreparedBy(by);
      onPatchDoc(doc.docEntry, { preparedBy: by });
    } catch {
      setPrepared(!next);
      onPatchDoc(doc.docEntry, { prepared: !next });
      toast.error("Échec de l'enregistrement");
    }
    finally { setSavingPrep(false); }
  }
  // Marquer « faite » passe par une vérification ; annuler le « fait » est direct.
  const togglePrepared = () => {
    if (departed) return;                  // une commande partie ne se re-bascule pas ici
    if (prepared) setPreparedTo(false);
    else setConfirmOpen(true);
  };

  // Statut « départ » (partie en livraison) — 3ᵉ état. Optimiste + persistance.
  const [departed, setDeparted] = useState<boolean>(!!doc.departed);
  const [departedBy, setDepartedBy] = useState<string | null>(doc.departedBy ?? null);
  const [savingDepart, setSavingDepart] = useState(false);

  async function setDepartedTo(next: boolean) {
    setDeparted(next);
    if (next) setPrepared(true);           // partir implique « faite »
    onPatchDoc(doc.docEntry, { departed: next, ...(next ? { prepared: true } : {}) });
    setSavingDepart(true);
    try {
      const res = await fetch("/api/livraisons/departed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, departed: next }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        setDeparted(!next);
        onPatchDoc(doc.docEntry, { departed: !next });
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement");
        return;
      }
      const by = next ? (j?.by ?? null) : null;
      setDepartedBy(by);
      onPatchDoc(doc.docEntry, { departedBy: by });
    } catch {
      setDeparted(!next);
      onPatchDoc(doc.docEntry, { departed: !next });
      toast.error("Échec de l'enregistrement");
    }
    finally { setSavingDepart(false); }
  }

  // Transitions d'état déclenchées depuis le menu contextuel (clic droit).
  function markAPreparer() { if (departed) setDepartedTo(false); if (prepared) setPreparedTo(false); }
  function markFait()      { if (departed) setDepartedTo(false); if (!prepared) setPreparedTo(true); }
  function markDepart()    { if (!departed) setDepartedTo(true); }

  // Ouvrir la commande en grand → s'affecter comme préparateur (qui clique prépare).
  async function openBig() {
    setBigOpen(true);
    try {
      const res = await fetch("/api/livraisons/preparer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, action: "claim" }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) {
        setPreparer(j.preparer ?? null); setIncomplete(false);
        onPatchDoc(doc.docEntry, { preparer: j.preparer ?? null, incomplete: false });
      }
    } catch { /* affectation non bloquante */ }
  }

  // Pas entièrement préparée → remise sur la file + signalement (notification).
  async function requeue() {
    setRequeuing(true);
    try {
      const res = await fetch("/api/livraisons/preparer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, action: "requeue" }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec"); return; }
      setPreparer(null); setIncomplete(true); setPrepared(false); setPreparedBy(null); setDeparted(false);
      setBigOpen(false);
      onPatchDoc(doc.docEntry, { preparer: null, incomplete: true, prepared: false, preparedBy: null, departed: false });
      toast.warning(`Commande #${doc.docNum} non terminée — remise sur la file`);
    } catch { toast.error("Échec"); }
    finally { setRequeuing(false); }
  }

  // Le transporteur courant doit rester sélectionnable même s'il n'est pas dans
  // la table Carrier (code SAP brut) → on l'injecte en tête si besoin.
  const options: CarrierOption[] = useMemo(() => {
    const base = carriers.slice();
    if (doc.trspCode && !base.some((c) => c.sapValue === doc.trspCode)) {
      base.unshift({ name: doc.carrierName ?? doc.trspCode, sapValue: doc.trspCode });
    }
    return base;
  }, [carriers, doc.trspCode, doc.carrierName]);

  async function handleCarrier(value: string) {
    if (value === (doc.trspCode ?? "")) return;
    setSavingCarrier(true);
    await onCarrierChange(doc.docEntry, value);
    setSavingCarrier(false);
  }

  // Modification : on résout le client puis on DIFFUSE la cible à l'Écran 2 (même
  // fenêtre, aucun nouvel onglet). L'Écran 2 bascule en saisie sur ce BL (mode
  // collant) et pré-remplit le panier avec ses lignes, éditables.
  const [modifBusy, setModifBusy] = useState(false);
  async function startModif() {
    setModifBusy(true);
    try {
      const r = await fetch(`/api/clients/resolve?code=${encodeURIComponent(doc.cardCode)}`);
      const j = await r.json().catch(() => null);
      if (!j?.id) {
        toast.error("Client introuvable en télévente — modification impossible depuis ici.");
        return;
      }
      broadcastActiveClient({
        clientId: j.id,
        clientName: doc.cardName,
        stockSharePct: 100,
        client: null,
        modif: { docEntry: doc.docEntry, docNum: doc.docNum },
      });
      toast.success(`Modification du BL #${doc.docNum} chargée sur l'Écran 2`, {
        description: "La saisie s'ouvre sur l'Écran 2 (même fenêtre).",
        duration: 6000,
      });
    } catch {
      toast.error("Échec du chargement de la modification.");
    } finally {
      setModifBusy(false);
    }
  }

  // ── Changer le CLIENT du BL (« re-coder ») : annule la commande et la recrée à
  //    l'identique sous un autre CardCode. Cas d'usage : mauvais client validé.
  //    Garde-fou : dialog de confirmation + aperçu du client cible avant exécution.
  const [rebindOpen, setRebindOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [preview, setPreview] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "ok"; cardCode: string; cardName: string; frozen: boolean; valid: boolean }
  >({ state: "idle" });
  const [rebinding, setRebinding] = useState(false);

  // Aperçu (débounce) : valide le CardCode saisi et affiche le nom du client cible.
  useEffect(() => {
    const code = newCode.trim();
    if (!rebindOpen || code.length < 2) { setPreview({ state: "idle" }); return; }
    if (code.toUpperCase() === doc.cardCode.toUpperCase()) {
      setPreview({ state: "error", message: "C'est déjà le client de cette commande." });
      return;
    }
    let cancelled = false;
    setPreview({ state: "loading" });
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/sap/orders/rebind?cardCode=${encodeURIComponent(code)}`);
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !j?.ok) { setPreview({ state: "error", message: j?.error || "Client introuvable." }); return; }
        setPreview({ state: "ok", cardCode: j.cardCode, cardName: j.cardName, frozen: j.frozen, valid: j.valid });
      } catch {
        if (!cancelled) setPreview({ state: "error", message: "SAP injoignable." });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [newCode, rebindOpen, doc.cardCode]);

  const canRebind = preview.state === "ok" && !preview.frozen && preview.valid;

  async function confirmRebind() {
    if (preview.state !== "ok" || !canRebind) return;
    setRebinding(true);
    try {
      const res = await fetch("/api/sap/orders/rebind", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, newCardCode: preview.cardCode }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec du changement de client"); return; }
      if (j.warning) toast.warning(j.warning, { duration: 10000 });
      else toast.success(`BL recréé pour ${preview.cardName} (#${j.newDocNum}) — ancien #${j.oldDocNum} annulé`, { duration: 7000 });
      setRebindOpen(false); setNewCode(""); setPreview({ state: "idle" });
      onReload();
    } catch {
      toast.error("SAP injoignable — client non modifié");
    } finally {
      setRebinding(false);
    }
  }

  // ── Menu contextuel (clic droit sur la ligne) → actions d'état + dispatch ──
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  function onRowContextMenu(e: ReactMouseEvent) {
    if (!doc.open) return;                                    // commande livrée/annulée : pas d'action
    const el = e.target as HTMLElement;
    if (el.closest("input, select, textarea")) return;        // garde le menu natif dans les champs (copier/coller)
    e.preventDefault();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 88) });
  }
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const docStatusOf: StatusTab = departed ? "DEPART" : prepared ? "FAIT" : "A_PREPARER";

  return (
    <li>
      <div
        onContextMenu={onRowContextMenu}
        className={`flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-secondary/25 transition-colors ${doc.excluded ? "opacity-50" : ""}`}
      >
        {/* Bouton d'état — toujours en tête, verticalement centré (placement
            constant). 3 états : À préparer → Fait → Parti. Clic droit = menu complet. */}
        <button
          type="button"
          onClick={departed ? () => setDepartedTo(false) : togglePrepared}
          disabled={savingPrep || savingDepart}
          title={departed
            ? "Commande partie en livraison — cliquer pour la ramener à « fait »"
            : prepared ? "Commande préparée (faite) — cliquer pour annuler" : "Marquer la commande comme préparée (faite)"}
          aria-pressed={prepared || departed}
          className={`inline-flex shrink-0 items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-lg text-[12px] font-bold uppercase tracking-wide transition-colors disabled:opacity-60 ${
            departed
              ? "bg-sky-500 text-white hover:bg-sky-600"
              : prepared
              ? "bg-emerald-500 text-white hover:bg-emerald-600"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/50 hover:bg-amber-500/25"
          }`}
        >
          {(savingPrep || savingDepart)
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : departed ? <Truck className="h-4 w-4" /> : prepared ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          <span className="hidden sm:inline">{departed ? "Parti" : prepared ? "Faite" : "À préparer"}</span>
        </button>

        {/* Identité client */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ClientLink
              code={doc.cardCode}
              name={doc.cardName}
              className="text-[14.5px] font-semibold text-foreground truncate text-left hover:underline decoration-brand-500/60 underline-offset-2 max-w-full"
            />
            {doc.clientType && (SEG_UI[doc.clientType as keyof typeof SEG_UI] ?? null) && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide ${SEG_UI[doc.clientType as keyof typeof SEG_UI].badge}`}>
                {SEG_UI[doc.clientType as keyof typeof SEG_UI].label}
              </span>
            )}
            {prepared && !departed && (preparedBy ?? preparer) && (
              <span title={`Préparée par ${displayPersonName(preparedBy ?? preparer)}`}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-semibold">
                <UserCheck className="h-3 w-3" /> Fait par {displayPersonName(preparedBy ?? preparer)}
              </span>
            )}
            {departed && (
              <span title={departedBy ? `Parti — ${displayPersonName(departedBy)}` : "Partie en livraison"}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                <Truck className="h-3 w-3" /> Parti{departedBy ? ` · ${displayPersonName(departedBy)}` : ""}
              </span>
            )}
            {incomplete && (
              <span title="Pas entièrement préparée — remise sur la file"
                className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                <AlertTriangle className="h-3 w-3" /> À reprendre
              </span>
            )}
            {preparer && !prepared && (
              <span title={`En préparation par ${displayPersonName(preparer)}`}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-[10px] font-semibold">
                <UserCheck className="h-3 w-3" /> {displayPersonName(preparer)}
              </span>
            )}
            {!doc.open && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                <CheckCircle2 className="h-2.5 w-2.5" /> Livrée
              </span>
            )}
            {doc.excluded && (
              <span title="BL totalement avoiré (facturé puis avoir total / doublon) — déduit des totaux"
                className="inline-flex items-center gap-1 rounded-full bg-rose-500 text-white px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                <RotateCcw className="h-2.5 w-2.5" /> Avoir — déduit
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
            <span className="font-mono text-foreground/60 hidden sm:inline">{doc.cardCode}</span>
            <span><span className="hidden sm:inline">· </span>BL n°{doc.docNum}</span>
            <span className="hidden sm:inline">· {fmtEur(doc.totalHT)} HT</span>
          </div>
          {/* Changement de transporteur / tournée / réf / date — dispatch (desktop
              uniquement + réservé aux commerciaux/admins ; masqué aux préparateurs
              qui n'ont qu'à préparer, pas à dispatcher). */}
          <div className={`mt-1.5 ${canDispatch ? "hidden md:flex" : "hidden"} flex-wrap items-center gap-1.5`}>
            <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="relative">
              <select
                value={doc.trspCode ?? ""}
                disabled={savingCarrier || !doc.open}
                onChange={(e) => handleCarrier(e.target.value)}
                aria-label={`Transporteur de la commande ${doc.docNum}`}
                title={doc.open ? "Changer le transporteur" : "Commande livrée — transporteur figé"}
                className="h-7 max-w-[200px] rounded-md border border-border bg-card pl-2 pr-7 text-[11.5px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
              >
                <option value="">Non affecté</option>
                {options.map((c) => (
                  <option key={c.sapValue} value={c.sapValue}>{c.name}</option>
                ))}
              </select>
              {savingCarrier ? (
                <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              )}
            </div>
            {/* Tournée du transporteur → fixe l'heure (U_TrspHeur). Visible dès qu'un
                transporteur est affecté et la commande ouverte. */}
            {doc.open && doc.trspCode && (
              <div className="relative">
                <select
                  value={selectedTourneeId}
                  disabled={savingTournee || !tournees}
                  onChange={(e) => handleTournee(e.target.value)}
                  aria-label={`Tournée de la commande ${doc.docNum}`}
                  title={tournees ? "Choisir la tournée (fixe l'heure, mémorisée pour le client)" : "Chargement des tournées…"}
                  className="h-7 max-w-[220px] rounded-md border border-border bg-card pl-2 pr-7 text-[11.5px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
                >
                  <option value="">
                    {!tournees ? "Chargement…" : (selectedTourneeId === "" && doc.trspHeure ? `${doc.trspHeure.slice(0, 5)} (à confirmer)` : "Tournée…")}
                  </option>
                  {(tournees ?? []).filter((t) => t.heure).map((t) => (
                    <option key={t.lineId} value={String(t.lineId)}>
                      {t.nom}{t.des ? ` (${t.des})` : ""} — {(t.heure as string).slice(0, 5)}
                    </option>
                  ))}
                </select>
                {savingTournee ? (
                  <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <Clock className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                )}
              </div>
            )}
            {/* N° de commande (réf. client) — éditable directement ici */}
            <div className="relative inline-flex items-center">
              <FileText className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" />
              <input
                value={refDraft}
                onChange={(e) => setRefDraft(e.target.value)}
                onBlur={saveRef}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                disabled={savingRef}
                placeholder="N° commande"
                title="N° de commande (réf. client) — Entrée ou clic ailleurs pour enregistrer"
                aria-label={`N° de commande de la livraison ${doc.docNum}`}
                className="h-7 w-[140px] rounded-md border border-border bg-card pl-7 pr-6 text-[11.5px] font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
              />
              {savingRef && <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {/* Date de livraison — modifiable directement ici */}
            <div className="relative inline-flex items-center">
              <CalendarDays className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" />
              <input
                type="date"
                value={dueISO}
                disabled={savingDate || !doc.open}
                onChange={(e) => e.target.value && handleDate(e.target.value)}
                title={doc.open ? "Changer la date de livraison du BL" : "Commande livrée — date figée"}
                aria-label={`Date de livraison de la commande ${doc.docNum}`}
                className="h-7 rounded-md border border-border bg-card pl-7 pr-2 text-[11.5px] font-medium text-foreground tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              {savingDate && <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </div>

        {/* Colis / poids — repère logistique (poids masqué sur mobile) */}
        <div className="flex items-center gap-4 sm:gap-8 shrink-0">
          <div className="text-right min-w-[44px]">
            <p className="text-[17px] sm:text-[15px] font-bold tnum text-foreground leading-none">{fmtNum(doc.colis)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">colis</p>
          </div>
          <div className="text-right min-w-[44px] hidden sm:block">
            <p className="text-[15px] font-bold tnum text-foreground leading-none">{fmtNum(doc.weightKg)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">kg</p>
          </div>
          {/* Ouvrir en grand (+ affecter au préparateur qui clique) */}
          <button
            type="button"
            onClick={openBig}
            title="Ouvrir la commande en grand (et se l'affecter)"
            aria-label={`Ouvrir la commande ${doc.docNum} en grand`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-brand-300/60 dark:border-brand-500/40 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/35 active:scale-95 transition-all"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          {canDispatch && doc.open && (
            <button
              type="button"
              onClick={startModif}
              disabled={modifBusy}
              title={`Modifier le BL #${doc.docNum} (sur l'Écran 2) — quantités + ajout de lignes`}
              className="hidden md:inline-flex items-center gap-1 h-9 px-2.5 rounded-lg border border-amber-300/70 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/20 text-[12px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/35 active:scale-95 transition-all disabled:opacity-60"
            >
              {modifBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />}
              <span className="hidden sm:inline">Modifier</span>
            </button>
          )}
          {/* Repli desktop uniquement : sur mobile le contenu est toujours affiché. */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Replier le détail" : "Voir le détail"}
            aria-expanded={open}
            className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-all"
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Contenu de la commande — TOUJOURS visible sur mobile (préparation),
          repliable sur desktop via le chevron. Chaque ligne porte ses tags
          (marque · conditionnement · origine). */}
      <div className={`px-4 sm:px-5 pb-3.5 pt-0.5 block ${open ? "md:block" : "md:hidden"}`}>
        <div className="rounded-xl border border-border/70 bg-secondary/20 overflow-hidden">
          {doc.comments && (
            <p className="px-3 py-2 text-[11.5px] text-muted-foreground border-b border-border/60 italic">
              {doc.comments}
            </p>
          )}
          <table className="w-full text-[12px]">
            <thead className="text-[9px] uppercase tracking-wider text-muted-foreground bg-card/40">
              <tr>
                <th className="text-center font-semibold px-2 py-1.5 w-14 whitespace-nowrap">Colis</th>
                <th className="text-left font-semibold px-3 py-1.5">Article</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">Qté</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {doc.lines.map((l, i) => (
                <tr key={`${l.itemCode}-${i}`}>
                  {/* Colisage en premier (gauche) — repère principal de préparation */}
                  <td className="px-2 py-1.5 text-center align-middle">
                    <span className="inline-flex min-w-[28px] items-center justify-center rounded-md bg-foreground/10 px-1.5 py-0.5 text-[14px] font-bold tnum text-foreground">
                      {fmtNum(l.colis)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 min-w-0 align-middle">
                    <div className="flex items-center gap-2.5">
                      <BrandLogo marque={l.marque} logos={brandLogos} size="md" zoomable />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="font-medium text-foreground/90">{l.itemName}</span>
                          <span className="font-mono text-[10px] text-muted-foreground/70 hidden sm:inline">{l.itemCode}</span>
                        </div>
                        <DesignationChips marque={l.marque} condt={l.condt} pays={l.pays} className="mt-1" />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tnum text-muted-foreground hidden sm:table-cell align-middle">{fmtNum(l.quantity)}</td>
                  <td className="px-3 py-1.5 text-right tnum text-muted-foreground hidden sm:table-cell align-middle">{fmtNum(l.weightKg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vue en GRAND — préparation focalisée + affectation au préparateur */}
      <Dialog open={bigOpen} onOpenChange={setBigOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[17px]">
              <Boxes className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0" />
              <span className="truncate min-w-0">{doc.cardName}</span>
              <span className="text-[12px] font-normal text-muted-foreground shrink-0">· BL n°{doc.docNum}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Détail de la livraison : lignes, colis et poids du bon de livraison.</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[26px] font-bold tnum text-foreground leading-none">
              {fmtNum(doc.colis)} <span className="text-[12px] font-medium uppercase text-muted-foreground">colis</span>
            </span>
            <span className="text-[15px] font-semibold tnum text-muted-foreground">{fmtNum(doc.weightKg)} kg</span>
            {(preparedBy ?? preparer) && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2.5 py-1 text-[12px] font-semibold">
                <UserCheck className="h-3.5 w-3.5" /> {prepared ? "Fait par" : "Préparée par"} {displayPersonName(preparedBy ?? preparer)}
              </span>
            )}
            {prepared && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-[12px] font-bold uppercase">
                <CheckCircle2 className="h-3.5 w-3.5" /> Faite
              </span>
            )}
          </div>
          {doc.comments && <p className="text-[12.5px] italic text-muted-foreground">« {doc.comments} »</p>}

          {/* Lignes en grand : colisage à gauche + tags */}
          <ul className="divide-y divide-border/50 rounded-xl border border-border overflow-hidden">
            {doc.lines.map((l, i) => (
              <li key={`big-${l.itemCode}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                <span className="inline-flex min-w-[44px] items-center justify-center rounded-lg bg-foreground/10 px-2 py-1 text-[18px] font-bold tnum text-foreground shrink-0">
                  {fmtNum(l.colis)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-foreground">{l.itemName}</p>
                  <DesignationChips marque={l.marque} condt={l.condt} pays={l.pays} className="mt-1" />
                </div>
                <BrandLogo marque={l.marque} logos={brandLogos} size="lg" className="self-center" zoomable />
              </li>
            ))}
          </ul>

          {/* Actions de préparation */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              type="button"
              onClick={() => { setPreparedTo(true); setBigOpen(false); }}
              disabled={savingPrep}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> Préparation terminée
            </button>
            <button
              type="button"
              onClick={requeue}
              disabled={requeuing}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-rose-300/70 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-[14px] font-semibold disabled:opacity-60"
            >
              {requeuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Pas terminée — remettre sur la file
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vérification avant de marquer « faite » (évite les validations par erreur) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
              <ListChecks className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Confirmer la préparation
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Confirme que la commande de <b className="text-foreground">{doc.cardName}</b> (BL n°{doc.docNum})
            est <b className="text-foreground">entièrement préparée</b>.
          </p>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5">
            <span className="text-[22px] font-bold tnum text-foreground leading-none">{fmtNum(doc.colis)}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">colis</span>
            <span className="ml-auto text-[12.5px] font-semibold tnum text-muted-foreground">{fmtNum(doc.weightKg)} kg · {doc.lineCount} article(s)</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="inline-flex flex-1 items-center justify-center h-11 px-4 rounded-xl border border-border text-[14px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); setPreparedTo(true); }}
              disabled={savingPrep}
              className="inline-flex flex-1 items-center justify-center gap-2 h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> Confirmer la préparation
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Changer le client du BL (re-coder) — garde-fou : annule + recrée */}
      <Dialog open={rebindOpen} onOpenChange={(o) => { if (!rebinding) { setRebindOpen(o); if (!o) { setNewCode(""); setPreview({ state: "idle" }); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
              <UserCog className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0" />
              Changer le client — BL n°{doc.docNum}
            </DialogTitle>
          </DialogHeader>

          {/* Client actuel → nouveau */}
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5 text-[13px]">
            <div className="min-w-0">
              <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground">Actuel</p>
              <p className="font-semibold text-foreground truncate">{doc.cardName}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{doc.cardCode}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mx-1" />
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground">Nouveau</p>
              {preview.state === "ok" ? (
                <>
                  <p className="font-semibold text-emerald-700 dark:text-emerald-300 truncate">{preview.cardName}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{preview.cardCode}</p>
                </>
              ) : (
                <p className="text-[12px] text-muted-foreground italic">Saisis le code ci-dessous…</p>
              )}
            </div>
          </div>

          {/* Saisie du nouveau code client */}
          <div>
            <label className="text-[12px] font-medium text-foreground">Code du client cible</label>
            <div className="relative mt-1">
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="Ex. ACAL"
                autoFocus
                disabled={rebinding}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 pr-9 text-[14px] font-medium text-foreground tracking-wide focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
              />
              {preview.state === "loading" && <Loader2 className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              {preview.state === "ok" && !preview.frozen && preview.valid && <CheckCircle2 className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />}
            </div>
            {preview.state === "error" && (
              <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-400">{preview.message}</p>
            )}
            {preview.state === "ok" && (preview.frozen || !preview.valid) && (
              <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-400">
                Client {preview.frozen ? "gelé" : "invalide"} dans SAP — commande impossible.
              </p>
            )}
          </div>

          {/* Garde-fou */}
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-3.5 py-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-amber-800 dark:text-amber-300 leading-relaxed">
              L&apos;ancien BL <b>#{doc.docNum}</b> sera <b>annulé</b> et un <b>nouveau BL</b> recréé à l&apos;identique
              (mêmes articles, prix, date, transporteur) pour le client cible. Action <b>irréversible</b> côté SAP.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setRebindOpen(false); setNewCode(""); setPreview({ state: "idle" }); }}
              disabled={rebinding}
              className="inline-flex flex-1 items-center justify-center h-11 px-4 rounded-xl border border-border text-[14px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={confirmRebind}
              disabled={!canRebind || rebinding}
              className="inline-flex flex-1 items-center justify-center gap-2 h-11 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-[13.5px] font-semibold disabled:opacity-50"
            >
              {rebinding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
              Annuler & recréer
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Menu contextuel (clic droit sur la ligne) */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
          />
          <div
            role="menu"
            className="fixed z-50 min-w-[210px] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg animate-fade-up"
            style={{ top: menu.y, left: menu.x }}
          >
            {/* Actions logistiques (commerciaux / admins) */}
            {canDispatch && (
              <>
                <MenuItem icon={Pencil} onClick={() => { setMenu(null); startModif(); }}>Modifier la commande</MenuItem>
                <MenuItem icon={UserCog} onClick={() => { setMenu(null); setRebindOpen(true); }}>Changer le client…</MenuItem>
                <div className="my-1 h-px bg-border" />
              </>
            )}
            {/* Changement d'état — accessible aux préparateurs / livreurs */}
            <MenuItem icon={Clock} accent="text-amber-600 dark:text-amber-400" active={docStatusOf === "A_PREPARER"}
              onClick={() => { setMenu(null); markAPreparer(); }}>À préparer</MenuItem>
            <MenuItem icon={CheckCircle2} accent="text-emerald-600 dark:text-emerald-400" active={docStatusOf === "FAIT"}
              onClick={() => { setMenu(null); markFait(); }}>Fait</MenuItem>
            <MenuItem icon={Truck} accent="text-sky-600 dark:text-sky-400" active={docStatusOf === "DEPART"}
              onClick={() => { setMenu(null); markDepart(); }}>Départ</MenuItem>
          </div>
        </>
      )}
    </li>
  );
}

/** Élément de menu contextuel — icône + libellé, coche si état courant. */
function MenuItem({
  icon: Icon, children, onClick, accent, active,
}: {
  icon: typeof Clock;
  children: ReactNode;
  onClick: () => void;
  accent?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary/60"
    >
      <Icon className={`h-4 w-4 shrink-0 ${accent ?? "text-brand-600 dark:text-brand-400"}`} />
      <span className="flex-1">{children}</span>
      {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-foreground/50" />}
    </button>
  );
}

/* ═════════════════════════════════════════════════════════════
   États vides / chargement
═════════════════════════════════════════════════════════════ */
function EmptyState({ date }: { date: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-16 px-6">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground mb-3">
        <PackageX className="h-7 w-7" strokeWidth={1.7} />
      </span>
      <p className="text-[15px] font-semibold text-foreground">Aucune commande à livrer</p>
      <p className="text-[12.5px] text-muted-foreground mt-1 max-w-xs">
        Rien n&apos;est planifié pour le {formatDeliveryDate(date)}. Changez de date
        ou actualisez si une commande vient d&apos;être saisie.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground px-1">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des commandes…
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden animate-pulse">
          <div className="h-14 border-b border-border bg-secondary/30" />
          <div className="divide-y divide-border/60">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-16 px-5 flex items-center">
                <div className="h-4 w-40 rounded bg-secondary/60" />
                <div className="ml-auto h-6 w-10 rounded bg-secondary/60" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
