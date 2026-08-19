"use client";

/**
 * DÉTAILS LIVRAISON — récap PAR ARTICLE de tout ce qui PART le jour J
 * (date de livraison = DocDueDate), avec les tags produit (marque ·
 * conditionnement · variété · origine) pour identifier précisément l'article,
 * et la quantité ventilée par segment GMS / CHR / EXPORT (+ total).
 *
 * ≠ Ventes du jour (qui liste les ventes SAISIES aujourd'hui, DocDate). Ici on
 * raisonne sur la date de LIVRAISON — ce qui quitte l'entrepôt ce jour-là.
 * Source : /api/livraisons?date=J (mode « due »). Consultation seule, à une
 * exception près : l'ÉCHANGE D'ARTICLE EN MASSE (clic droit sur une ligne OU
 * bouton « ⋯ » visible — les tablettes d'entrepôt n'ont pas de clic droit).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { floatingPortalTarget } from "@/lib/floatingPortal";
import { Loader2, MoreHorizontal, Package, Printer, RefreshCw, Search, ArrowRight, Replace, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatDeliveryDate, nextDeliveryDate } from "@/lib/livraison";
import { DateStepper } from "@/components/ui/date-stepper";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { printArticlesRecap } from "@/components/livraisons/printRecap";
import type { ApiResp } from "@/lib/livraisonView";

const SEGMENTS = ["GMS", "CHR", "EXPORT"] as const;
type Segment = (typeof SEGMENTS)[number];
type Metric = "colis" | "kg";

interface SegQty { colis: number; kg: number }
interface Row {
  itemCode: string;
  itemName: string;
  tags: string[];
  seg: Record<Segment, SegQty>;
  /** BL OUVERTS du jour contenant cet article — cibles de l'échange en masse. */
  openDocs: number[];
}

const nfKg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nfColis = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const cleanTag = (v: string | null | undefined) => (v ?? "").trim();

export function DetailsLivraisonArticles() {
  const [date, setDate] = useState(() => nextDeliveryDate());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [metric, setMetric] = useState<Metric>("colis");
  // Échange d'article EN MASSE : remplace le code sur TOUS les BL ouverts du
  // jour qui le portent (modif SAP par bon). Deux entrées équivalentes : le
  // clic droit sur la ligne, et le bouton « ⋯ » toujours visible (tablettes).
  const [bulk, setBulk] = useState<{ x: number; y: number; oldCode: string; oldName: string; docEntries: number[] } | null>(null);
  const openBulk = useCallback((e: ReactMouseEvent, a: Row) => {
    if (a.openDocs.length === 0) return;                 // aucun BL ouvert → rien à échanger
    e.preventDefault();
    setBulk({
      x: Math.min(e.clientX, window.innerWidth - 312),
      y: Math.min(e.clientY, window.innerHeight - 360),
      oldCode: a.itemCode, oldName: a.itemName, docEntries: a.openDocs,
    });
  }, []);
  // Même panneau, ancré sous le bouton « ⋯ » de la ligne.
  const openBulkFromButton = useCallback((e: ReactMouseEvent<HTMLButtonElement>, a: Row) => {
    if (a.openDocs.length === 0) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setBulk({
      x: Math.max(8, Math.min(r.right - 300, window.innerWidth - 312)),
      y: Math.min(r.bottom + 4, window.innerHeight - 360),
      oldCode: a.itemCode, oldName: a.itemName, docEntries: a.openDocs,
    });
  }, []);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/livraisons?date=${d}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) setData(j); else toast.error(j?.error || "Livraisons indisponibles");
    } catch {
      toast.error("SAP injoignable — livraisons non chargées");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const needle = q.trim().toLowerCase();
  const { rows, docCount } = useMemo(() => {
    const map = new Map<string, Row>();
    const openDocsByItem = new Map<string, Set<number>>();
    let docs = 0;
    if (data?.ok) {
      for (const c of data.carriers) for (const d of c.docs) {
        const seg = d.clientType as Segment | null;
        if (d.excluded || !seg || !(SEGMENTS as readonly string[]).includes(seg)) continue;
        docs++;
        for (const l of d.lines) {
          let a = map.get(l.itemCode);
          if (!a) {
            const tags = [cleanTag(l.marque), cleanTag(l.condt), cleanTag(l.calibre), cleanTag(l.variete), cleanTag(l.pays)]
              .filter((t) => t && t.toUpperCase() !== l.itemName.toUpperCase());
            a = { itemCode: l.itemCode, itemName: l.itemName, tags: [...new Set(tags)],
              seg: { GMS: { colis: 0, kg: 0 }, CHR: { colis: 0, kg: 0 }, EXPORT: { colis: 0, kg: 0 } }, openDocs: [] };
            map.set(l.itemCode, a);
          }
          a.seg[seg].colis += l.colis || 0;
          a.seg[seg].kg += l.weightKg || 0;
          // BL ouverts uniquement (les clôturés/livrés ne sont pas modifiables).
          if (d.open) {
            let set = openDocsByItem.get(l.itemCode);
            if (!set) { set = new Set(); openDocsByItem.set(l.itemCode, set); }
            set.add(d.docEntry);
          }
        }
      }
    }
    for (const [code, set] of openDocsByItem) { const a = map.get(code); if (a) a.openDocs = [...set]; }
    let list = [...map.values()];
    if (needle) list = list.filter((a) =>
      a.itemName.toLowerCase().includes(needle) || a.itemCode.toLowerCase().includes(needle) ||
      a.tags.some((t) => t.toLowerCase().includes(needle)));
    const val = (q2: SegQty) => (metric === "kg" ? q2.kg : q2.colis);
    const tot = (a: Row) => SEGMENTS.reduce((s, g) => s + val(a.seg[g]), 0);
    list.sort((x, y) => tot(y) - tot(x));
    return { rows: list, docCount: docs };
  }, [data, needle, metric]);

  const val = (q2: SegQty) => (metric === "kg" ? q2.kg : q2.colis);
  const fmt = (n: number) => (n <= 0 ? <span className="text-muted-foreground/40">—</span> : (metric === "kg" ? nfKg : nfColis).format(n));
  const rowTotal = (a: Row) => SEGMENTS.reduce((s, g) => s + val(a.seg[g]), 0);
  const colTotals = { GMS: 0, CHR: 0, EXPORT: 0, all: 0 };
  for (const a of rows) for (const g of SEGMENTS) { colTotals[g] += val(a.seg[g]); colTotals.all += val(a.seg[g]); }
  const unit = metric === "kg" ? "kg" : "colis";

  return (
    <div className="space-y-5">
      {/* Contrôles : date + recherche + rafraîchir + imprimer */}
      <div className="flex flex-wrap items-center gap-2">
        <DateStepper value={date} onChange={setDate} className="shrink-0" />
        <div className="relative min-w-[180px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par article, marque, origine…"
            aria-label="Filtrer les articles"
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-body focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <Button variant="outline" size="lg" onClick={() => load(date)} disabled={loading} className="shrink-0">
          <RefreshCw className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="shrink-0"
          onClick={() => {
            if (rows.length === 0) { toast.info("Rien à imprimer pour ce jour."); return; }
            const ok = printArticlesRecap({
              dateLabel: formatDeliveryDate(data?.date ?? date),
              unit,
              rows: rows.map((a) => ({ itemName: a.itemName, tags: a.tags, gms: val(a.seg.GMS), chr: val(a.seg.CHR), exp: val(a.seg.EXPORT), total: rowTotal(a) })),
              totals: { gms: colTotals.GMS, chr: colTotals.CHR, exp: colTotals.EXPORT, all: colTotals.all },
            });
            if (!ok) toast.error("Impression bloquée — autorise les fenêtres pop-up.");
          }}
          disabled={loading || rows.length === 0}
          title="Imprimer le récap par article (unité affichée)"
        >
          <Printer />
          <span className="hidden sm:inline">Imprimer</span>
        </Button>
      </div>

      <section aria-label="Livraison par article">
        {/* En-tête AU-DESSUS de la surface (motif GroupedList) : titre + compteurs
            à gauche, bascule d'unité à droite. */}
        <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2 px-4">
          <div className="min-w-0">
            <h2 className="truncate text-body font-semibold text-foreground">
              Livraison par article{data?.date ? ` — ${formatDeliveryDate(data.date)}` : ""}
            </h2>
            <p className="tnum text-caption text-muted-foreground">
              {loading && !data ? "Chargement…" : `${rows.length} article${rows.length > 1 ? "s" : ""} · ${docCount} livraison${docCount > 1 ? "s" : ""} · GMS / CHR / Export`}
            </p>
          </div>
          <SegmentedControl<Metric>
            value={metric}
            onChange={setMetric}
            options={[{ value: "colis", label: "Colis" }, { value: "kg", label: "Kg" }]}
            size="sm"
            aria-label="Unité affichée"
            className="shrink-0"
          />
        </div>

        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
          {loading && !data ? (
            <div role="status" aria-label="Chargement des livraisons" className="divide-y divide-border">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="ml-auto h-3.5 w-1/4" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Aucune livraison"
              description={<>Aucune livraison GMS / CHR / Export ce jour{needle ? " pour cette recherche" : ""}.</>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                {/* Colonnes de segment SANS couleur : la couleur est réservée aux
                    états (le segment est une identité, pas une alerte). */}
                <thead>
                  <tr className="border-b border-border/70 text-caption2 uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pl-4 pr-3 text-left font-semibold">Article</th>
                    {SEGMENTS.map((g) => (
                      <th key={g} className="px-3 py-2 text-right font-semibold">{g === "EXPORT" ? "Export" : g}</th>
                    ))}
                    <th className="py-2 pl-3 pr-3 text-right font-semibold">Total</th>
                    {/* Colonne du menu « ⋯ » (échange en masse). */}
                    <th className="w-10 py-2 pr-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {rows.map((a) => (
                    <tr
                      key={a.itemCode}
                      onContextMenu={(e) => openBulk(e, a)}
                      title={a.openDocs.length > 0 ? `Clic droit ou « ⋯ » : échanger cet article sur ${a.openDocs.length} bon(s) du jour` : undefined}
                      className={`border-b border-border/40 align-top transition-colors last:border-0 hover:bg-secondary/40 ${a.openDocs.length > 0 ? "cursor-context-menu" : ""}`}
                    >
                      <td className="py-2 pl-4 pr-3">
                        <p className="font-medium leading-tight text-foreground">{a.itemName}</p>
                        {/* Tags produit en texte muted (plus de chips) : la ligne
                            reste dense et rien ne concurrence les alertes. */}
                        {a.tags.length > 0 && (
                          <p className="mt-0.5 text-caption text-muted-foreground">{a.tags.join(" · ")}</p>
                        )}
                      </td>
                      {SEGMENTS.map((g) => (
                        <td key={g} className="px-3 py-2 text-right text-foreground/90">{fmt(val(a.seg[g]))}</td>
                      ))}
                      <td className="py-2 pl-3 pr-3 text-right font-bold text-foreground">{fmt(rowTotal(a))}</td>
                      <td className="py-1.5 pr-2 text-right">
                        {a.openDocs.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => openBulkFromButton(e, a)}
                            aria-label={`Actions sur « ${a.itemName} » — échanger l'article sur ${a.openDocs.length} bon(s) du jour`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MoreHorizontal size={16} aria-hidden />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border/70 bg-secondary/20 font-bold text-foreground">
                    <td className="py-2 pl-4 pr-3">Total ({unit})</td>
                    {SEGMENTS.map((g) => (
                      <td key={g} className="px-3 py-2 text-right">{fmt(colTotals[g])}</td>
                    ))}
                    <td className="py-2 pl-3 pr-3 text-right">{fmt(colTotals.all)}</td>
                    <td className="py-2 pr-2" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Échange d'article en masse (clic droit sur une ligne OU bouton « ⋯ »). */}
      {bulk && (
        <BulkSwapMenu
          pos={bulk}
          onClose={() => setBulk(null)}
          onDone={() => load(date)}
        />
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Échange d'article EN MASSE — remplace un code article par un autre sur TOUS
   les BL ouverts du jour qui le portent. Un appel de modif SAP par bon
   (/api/sap/orders/[docEntry]/modif), quantité et prix conservés, nouveau lot
   FIFO résolu côté serveur. Confirmation obligatoire (action irréversible et
   multi-bons). Les lignes déjà livrées / bons contenant déjà le nouvel article
   sont ignorés (comptés « ignorés »).
═════════════════════════════════════════════════════════════ */
interface BulkProduct { itemCode: string; itemName: string }
interface BulkSrcLine {
  itemCode: string; qtyPieces: number;
  price: number | null; warehouse: string | null; lot: string | null; closed: boolean;
}

async function swapArticleOnBL(docEntry: number, oldCode: string, newCode: string): Promise<{ status: "ok" | "skip" | "error"; error?: string }> {
  try {
    const g = await fetch(`/api/sap/orders/${docEntry}/modif`, { cache: "no-store" }).then((r) => r.json());
    // ⚠️ L'endpoint renvoie `cartLines` (et non `lines`) : lire `g.lines` faisait
    // échouer TOUS les échanges avant même l'appel SAP (« 0 modifié, N échecs »).
    if (!g?.ok || !Array.isArray(g.cartLines)) return { status: "error", error: g?.error || "Bon illisible" };
    const src = g.cartLines as BulkSrcLine[];
    const targets = src.filter((l) => l.itemCode === oldCode);
    if (targets.length === 0) return { status: "skip" };                    // article absent (déjà échangé ?)
    if (targets.some((l) => l.closed)) return { status: "skip" };           // déjà livré → non modifiable
    if (src.some((l) => l.itemCode === newCode)) return { status: "skip" }; // éviter un doublon d'article
    const lines = src.map((l) => l.itemCode === oldCode
      ? { itemCode: newCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: false }
      : { itemCode: l.itemCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: true, lot: l.lot ?? undefined });
    const res = await fetch(`/api/sap/orders/${docEntry}/modif`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }),
    }).then((r) => r.json());
    return res?.ok ? { status: "ok" } : { status: "error", error: res?.error };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

function BulkSwapMenu({ pos, onClose, onDone }: {
  pos: { x: number; y: number; oldCode: string; oldName: string; docEntries: number[] };
  onClose: () => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BulkProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<BulkProduct | null>(null);   // produit choisi, en attente de confirmation
  const [running, setRunning] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/products?search=${encodeURIComponent(q)}&limit=12`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { products?: BulkProduct[] }) => { if (my === seq.current) setResults(j.products ?? []); })
        .catch(() => { if (my === seq.current) setResults([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 220);
    return () => clearTimeout(h);
  }, [query]);

  // `composedPath()` plutôt que `.contains()` sur `e.target` (plus fiable pour un
  // panneau en portail séparé) ; `pointerdown` pour matcher l'évènement écouté
  // par Radix (Dialog/FullscreenPanel englobant).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!running && boxRef.current && !e.composedPath().includes(boxRef.current)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) onClose(); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose, running]);

  async function run(p: BulkProduct) {
    if (running) return;
    if (p.itemCode === pos.oldCode) { onClose(); return; }
    setRunning(true);
    let ok = 0, skip = 0, err = 0, firstErr = "";
    for (const de of pos.docEntries) {
      const r = await swapArticleOnBL(de, pos.oldCode, p.itemCode);
      if (r.status === "ok") ok++;
      else if (r.status === "skip") skip++;
      else { err++; if (!firstErr && r.error) firstErr = r.error; }
    }
    const desc = `${ok} bon(s) modifié(s)${skip ? `, ${skip} ignoré(s)` : ""}${err ? `, ${err} échec(s)` : ""}.${err && firstErr ? ` — ${firstErr}` : ""}`;
    if (err > 0) toast.error(`Échange « ${pos.oldName} » → « ${p.itemName} »`, { description: desc });
    else toast.success(`Échange « ${pos.oldName} » → « ${p.itemName} »`, { description: desc });
    onDone();
    onClose();
  }

  return createPortal(
    <div
      ref={boxRef}
      data-floating-root=""
      style={{ position: "fixed", left: pos.x, top: pos.y, width: 300 }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // `pointer-events-auto` OBLIGATOIRE quand ce panneau s'ouvre au-dessus d'un
      // Dialog/FullscreenPanel Radix (modal) : Radix pose `pointer-events:none` sur
      // <body>, dont ce popup hérite (porté dans <body>) — les clics le
      // traverseraient et son détecteur de « clic dehors » le refermerait.
      className="pointer-events-auto z-[130] rounded-xl border border-border bg-card shadow-modal overflow-hidden flex flex-col max-h-[360px] animate-fade-up"
    >
      <div className="shrink-0 px-3 py-2 border-b border-border bg-secondary/30">
        <p className="text-caption2 font-semibold text-foreground inline-flex items-center gap-1.5">
          <Replace className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" /> Échanger en masse
        </p>
        <p className="text-caption2 text-muted-foreground truncate mt-0.5">
          <span className="font-semibold text-foreground">{pos.oldName}</span> · {pos.docEntries.length} bon(s) du jour
        </p>
      </div>

      {pending ? (
        <div className="p-3 space-y-2.5">
          <p className="text-body text-foreground inline-flex items-start gap-1.5">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <span>
              Remplacer <b>{pos.oldName}</b> par <b>{pending.itemName}</b> sur <b>{pos.docEntries.length} bon(s)</b> ? Quantité et prix conservés. Action irréversible.
            </span>
          </p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={running} onClick={() => run(pending)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-body font-semibold disabled:opacity-60 transition-colors">
              {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Échange…</> : <>Confirmer</>}
            </button>
            <button type="button" disabled={running} onClick={() => setPending(null)}
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg border border-border text-body font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-60 transition-colors">
              Retour
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 relative px-2 pt-2">
            <Search className="pointer-events-none absolute left-4 top-[calc(50%+4px)] -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nouveau produit (nom ou code)…"
              aria-label="Rechercher l'article de remplacement"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-body focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            {loading && <Loader2 className="absolute right-4 top-[calc(50%+4px)] -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="overflow-y-auto py-1 min-h-0">
            {query.trim().length < 2 ? (
              <p className="px-3 py-2 text-caption italic text-muted-foreground">Tape au moins 2 caractères…</p>
            ) : results.length === 0 && !loading ? (
              <p className="px-3 py-2 text-caption italic text-muted-foreground">Aucun produit trouvé.</p>
            ) : results.map((p) => (
              <button
                key={p.itemCode}
                type="button"
                onClick={() => setPending(p)}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-secondary/60 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-foreground truncate">{p.itemName}</span>
                  <span className="block text-caption2 font-mono text-muted-foreground">{p.itemCode}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    // Porté DANS le Dialog : sinon son piège à focus rapatrie le focus et ce
    // champ de recherche (autoFocus) est inutilisable — cf. lib/floatingPortal.ts.
    floatingPortalTarget(boxRef.current),
  );
}
