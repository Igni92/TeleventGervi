"use client";

/**
 * BONS DE PRÉPARATION EXPORT — panneau d'affectation des lots (Détail livraison).
 *
 * Circuit export (cf. lib/bonPrep) : la saisie télévente d'un client EXPORT crée
 * un bon de préparation HORS SAP. Ici, on AFFECTE un lot à chaque ligne (parmi
 * les arrivages connus, suggestions basées sur l'affectation des EM — Export en
 * tête), puis « Créer le BL » crée la commande SAP proprement avec ces lots.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList, ChevronDown, RefreshCw, Loader2, Trash2, CheckCircle2,
  Sparkles, FileText, CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { displayPersonName } from "@/lib/userNames";
import { formatDeliveryDate } from "@/lib/livraison";

interface BonLine {
  itemCode: string;
  itemName?: string;
  quantity: number;
  displayQuantity?: number;
  displayUnit?: string;
  warehouseCode?: string;
  price?: number;
  discountPercent?: number;
}
interface Bon {
  id: string;
  createdAt: string;
  createdBy: string | null;
  clientName: string;
  cardCode: string;
  segment: string | null;
  status: "A_AFFECTER" | "TRANSFORME";
  lots: (string | null)[];
  orderBody: {
    deliveryDate: string;
    numAtCard?: string;
    comments?: string;
    lines: BonLine[];
  } & Record<string, unknown>;
  result?: { docNum: number; docEntry: number; at: string } | null;
}
interface LotCandidate { lot: string; docNum: number; warehouse: string | null; affect: string }
type Candidates = Record<string, { candidates: LotCandidate[]; suggested: string | null }>;

const AFFECT_LABEL: Record<string, string> = { TOUS: "Tous", EXPORT: "Export", GMS: "GMS", CHR: "CHR" };

export function BonsPreparationPanel({ refreshKey, onOrderCreated }: {
  /** Incrémenté par le parent (« Actualiser » / rechargements) → recharge la liste. */
  refreshKey: number;
  /** Appelé après la création d'un BL (le Détail livraison doit se recharger). */
  onOrderCreated: () => void;
}) {
  const [bons, setBons] = useState<Bon[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidates>({});
  const [pendingLot, setPendingLot] = useState("EM_PENDING");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);   // id du bon en cours (BL / suppression)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/bons-preparation", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!j?.ok) { setBons([]); return; }
      const open: Bon[] = (j.bons ?? []).filter((b: Bon) => b.status === "A_AFFECTER");
      setBons(open);
      // Candidats de lots pour TOUS les articles des bons ouverts (une requête).
      const items = [...new Set(open.flatMap((b) => b.orderBody.lines.map((l) => l.itemCode)))];
      if (items.length) {
        const rc = await fetch(`/api/lots/candidates?items=${encodeURIComponent(items.join(","))}&segment=EXPORT`, { cache: "no-store" });
        const jc = await rc.json().catch(() => null);
        if (jc?.ok) {
          setCandidates(jc.items ?? {});
          if (typeof jc.pending === "string") setPendingLot(jc.pending);
        }
      }
    } catch {
      setBons((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Pose un lot sur UNE ligne — optimiste + PATCH du tableau complet.
  const saveLots = useCallback(async (bon: Bon, lots: (string | null)[]) => {
    setBons((prev) => prev?.map((b) => (b.id === bon.id ? { ...b, lots } : b)) ?? prev);
    try {
      const r = await fetch("/api/bons-preparation", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: bon.id, lots }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast.error(j?.error || "Échec de l'enregistrement des lots");
        load();
      }
    } catch {
      toast.error("Échec de l'enregistrement des lots");
      load();
    }
  }, [load]);

  const setLot = (bon: Bon, idx: number, lot: string) => {
    const lots = bon.lots.slice();
    lots[idx] = lot || null;
    saveLots(bon, lots);
  };

  // Remplit les lignes SANS lot avec la suggestion (EM du segment, sinon à découvert).
  const applySuggestions = (bon: Bon) => {
    const lots = bon.orderBody.lines.map((l, i) =>
      bon.lots[i] ?? candidates[l.itemCode]?.suggested ?? pendingLot);
    saveLots(bon, lots);
  };

  // « Créer le BL » — repost de /api/sap/orders avec bonPrepId + lot par ligne.
  // Encours dépassé (409 needsConfirm) → confirmation puis retry forcé.
  async function createBL(bon: Bon) {
    if (bon.lots.some((l) => !l)) { toast.error("Affecte un lot à chaque ligne d'abord."); return; }
    setBusy(bon.id);
    try {
      const post = (confirmEncours: boolean) =>
        fetch("/api/sap/orders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...bon.orderBody,
            bonPrepId: bon.id,
            confirmEncours,
            lines: bon.orderBody.lines.map((l, i) => ({ ...l, lot: bon.lots[i] })),
          }),
        });
      let res = await post(false);
      let json = await res.json().catch(() => null);
      if (res.status === 409 && json?.needsConfirm === "encours") {
        const ok = window.confirm(`${json.error}\n\nCréer le BL quand même ?`);
        if (!ok) return;
        res = await post(true);
        json = await res.json().catch(() => null);
      }
      if (!res.ok || !json?.ok) {
        toast.error(json?.blocked ? "Client bloqué" : "Échec de la création du BL", { description: json?.error, duration: 10000 });
        return;
      }
      toast.success(`BL #${json.docNum} créé — ${bon.clientName}`, { description: "Lots affectés.", duration: 8000 });
      setBons((prev) => prev?.filter((b) => b.id !== bon.id) ?? prev);
      onOrderCreated();
    } catch {
      toast.error("SAP injoignable — BL non créé");
    } finally {
      setBusy(null);
    }
  }

  async function remove(bon: Bon) {
    if (!window.confirm(`Supprimer le bon de préparation de ${bon.clientName} (${bon.orderBody.lines.length} ligne(s)) ?`)) return;
    setBusy(bon.id);
    try {
      const r = await fetch(`/api/bons-preparation?id=${encodeURIComponent(bon.id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de la suppression"); return; }
      toast.success(`Bon de préparation supprimé (${bon.clientName})`);
      setBons((prev) => prev?.filter((b) => b.id !== bon.id) ?? prev);
    } catch {
      toast.error("Échec de la suppression");
    } finally {
      setBusy(null);
    }
  }

  const count = bons?.length ?? 0;
  // Rien à afficher : le panneau disparaît complètement (écran inchangé).
  const empty = useMemo(() => bons !== null && count === 0, [bons, count]);
  if (empty) return null;

  return (
    <section className="rounded-2xl border border-violet-300/60 dark:border-violet-500/30 bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-violet-300/40 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-900/15">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
            <ClipboardList className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground leading-tight">
              Bons de préparation export — lots à affecter
            </p>
            <p className="text-[11px] text-muted-foreground">
              {bons === null ? "Chargement…" : `${count} bon${count > 1 ? "s" : ""} en attente : affecte un lot à chaque ligne puis crée le BL.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {(bons ?? []).map((bon) => {
        const isCollapsed = collapsed.has(bon.id);
        const missing = bon.lots.filter((l) => !l).length;
        const ready = missing === 0;
        const isBusy = busy === bon.id;
        return (
          <div key={bon.id} className="border-b border-border/60 last:border-b-0">
            {/* En-tête du bon — client, livraison, vendeur */}
            <div
              role="button" tabIndex={0}
              onClick={() => setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(bon.id)) next.delete(bon.id); else next.add(bon.id);
                return next;
              })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 bg-secondary/20 hover:bg-secondary/40 cursor-pointer select-none transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                <span className="text-[13.5px] font-semibold text-foreground truncate">{bon.clientName}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                  Export
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarDays className="h-3 w-3" /> {formatDeliveryDate(bon.orderBody.deliveryDate)}
                </span>
                {bon.createdBy && (
                  <span className="text-[11px] text-muted-foreground">· par {displayPersonName(bon.createdBy)}</span>
                )}
              </div>
              <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                ready
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              }`}>
                {ready ? <><CheckCircle2 className="h-3 w-3" /> Lots complets</> : `${missing} lot${missing > 1 ? "s" : ""} à affecter`}
              </span>
            </div>

            {!isCollapsed && (
              <div className="px-4 sm:px-5 py-3 space-y-3">
                {/* Lignes : article · qté · lot à choisir */}
                <ul className="divide-y divide-border/50 rounded-xl border border-border overflow-hidden">
                  {bon.orderBody.lines.map((l, i) => {
                    const cand = candidates[l.itemCode];
                    const current = bon.lots[i] ?? "";
                    // Le lot courant peut venir d'une EM hors liste (saisie plus ancienne) → injecté.
                    const opts = cand?.candidates ?? [];
                    const hasCurrent = !current || current === pendingLot || opts.some((c) => c.lot === current);
                    return (
                      <li key={`${bon.id}-${i}`} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-foreground truncate">
                            {l.itemName ?? l.itemCode}
                            <span className="ml-2 font-mono text-[10px] text-muted-foreground/70 hidden sm:inline">{l.itemCode}</span>
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {l.displayQuantity != null
                              ? `${l.displayQuantity} ${l.displayUnit ?? "colis"} (${l.quantity} pie)`
                              : `${l.quantity} pie`}
                            {l.warehouseCode ? ` · mag. ${l.warehouseCode}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 sm:w-[300px]">
                          <select
                            value={current}
                            disabled={isBusy}
                            onChange={(e) => setLot(bon, i, e.target.value)}
                            aria-label={`Lot de ${l.itemName ?? l.itemCode}`}
                            className={`h-9 w-full rounded-lg border bg-card px-2.5 text-[12.5px] font-medium focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-60 cursor-pointer ${
                              current ? "border-border text-foreground" : "border-amber-400/60 text-amber-700 dark:text-amber-300"
                            }`}
                          >
                            <option value="">Choisir le lot…</option>
                            {cand?.suggested && (
                              <option value={cand.suggested}>
                                ★ {cand.suggested} (suggéré)
                              </option>
                            )}
                            {opts.filter((c) => c.lot !== cand?.suggested).map((c) => (
                              <option key={c.lot} value={c.lot}>
                                {c.lot} · {AFFECT_LABEL[c.affect] ?? c.affect}{c.warehouse ? ` · mag. ${c.warehouse}` : ""}
                              </option>
                            ))}
                            {!hasCurrent && <option value={current}>{current}</option>}
                            <option value={pendingLot}>À découvert — arrivage à venir ({pendingLot})</option>
                          </select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {bon.orderBody.comments && (
                  <p className="text-[11.5px] italic text-muted-foreground">« {bon.orderBody.comments} »</p>
                )}

                {/* Actions du bon */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => createBL(bon)}
                    disabled={!ready || isBusy}
                    title={ready ? "Créer la commande SAP avec les lots affectés" : "Affecte un lot à chaque ligne d'abord"}
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold disabled:opacity-50 active:scale-95 transition-all"
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    Créer le BL
                  </button>
                  <button
                    type="button"
                    onClick={() => applySuggestions(bon)}
                    disabled={isBusy || ready}
                    title="Remplir les lignes sans lot avec la suggestion (arrivage Export, sinon à découvert)"
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-border text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" /> Suggérer les lots
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(bon)}
                    disabled={isBusy}
                    title="Supprimer ce bon de préparation (aucun BL ne sera créé)"
                    className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {bons === null && (
        <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement des bons de préparation…
        </div>
      )}
    </section>
  );
}
