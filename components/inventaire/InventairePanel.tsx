"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, Send, CheckCircle2, AlertTriangle, ClipboardList, Camera, ChevronRight,
  ChevronLeft, Pencil, X, ImageIcon, ScanLine, PackageCheck, RotateCcw, Save,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { GuidedCounter } from "./GuidedCounter";
import { PhotoStep } from "./PhotoStep";
import {
  buildFamilies, sapInfo, ecartOf, fmt, fmtDate, fruitEmoji, MAX_PHOTOS,
  type Product, type DraftPhoto,
} from "./inv-utils";

/* ---- DTO côté client (on n'importe pas lib/inventory : il tire Prisma) ---- */
type LineDTO = { itemCode: string; itemName: string; sapQty: number; realQty: number; unit: string; ecart: number };
type PhotoDTO = { id: string; dataUrl: string; w: number; h: number };
type SessionDTO = {
  id: string; status: "submitted" | "reviewed"; createdBy: string; note: string;
  lines: LineDTO[]; photos: PhotoDTO[]; nbEcarts: number; createdAt: string;
  reviewedAt: string | null; reviewedBy: string | null;
  reopenedAt?: string | null; reopenedBy?: string | null;
  updatedAt?: string | null; updatedBy?: string | null; nbPhotos?: number;
};

/** Estime le poids décodé (octets) d'une data-URL base64 (pour l'affichage en édition). */
function estimateBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : "";
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

type Counts = Record<string, number | null>;
type Mode = "home" | "count" | "recap";
type Scope = { products: Product[]; label: string; startIndex: number };
/** Ligne du récap (produit en stock OU ligne orpheline d'une correction). */
type RecapRow = { itemCode: string; itemName: string; sapQty: number; real: number; unit: string; ecart: number; emoji: string; orphan: boolean };

const DRAFT_KEY = "tv-inv-draft-v2";
const PHOTOS_KEY = "tv-inv-photos-v2";

const isCounted = (v: number | null | undefined) => v != null && Number.isFinite(v);
const firstUncounted = (list: Product[], counts: Counts) => {
  const i = list.findIndex((p) => !isCounted(counts[p.itemCode]));
  return i < 0 ? 0 : i;
};

export function InventairePanel({ isAdmin, isPreparateur = false }: { isAdmin: boolean; isPreparateur?: boolean }) {
  // Admin OU préparateur (« personne en charge du stock ») : peut voir tous les
  // inventaires et repasser dessus (valider / rouvrir / corriger).
  const canManage = isAdmin || isPreparateur;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Brouillon (persisté localStorage)
  const [counts, setCounts] = useState<Counts>({});
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const hydrated = useRef(false);

  // Correction d'un inventaire existant (« repasser dessus »). Quand non-null,
  // le brouillon courant est celui de la session éditée : on NE persiste pas en
  // localStorage (le brouillon « nouveau comptage » reste intact) et l'envoi
  // fait un PUT (mise à jour en place) plutôt qu'un POST.
  const [editing, setEditing] = useState<SessionDTO | null>(null);
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null);

  // Navigation
  const [mode, setMode] = useState<Mode>("home");
  const [scope, setScope] = useState<Scope | null>(null);

  // Lightbox + photos de session (admin/historique, chargées à la demande)
  const [preview, setPreview] = useState<string | null>(null);
  const [sessionPhotos, setSessionPhotos] = useState<Record<string, PhotoDTO[] | "loading">>({});

  /* ---------------------------- Chargements ---------------------------- */
  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products?inStock=true&limit=400", { cache: "no-store" });
      const json = await res.json();
      setProducts(json.products ?? []);
    } catch { setProducts([]); }
    finally { setLoading(false); }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/inventaire", { cache: "no-store" });
      const json = await res.json();
      setSessions(json.sessions ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadProducts(); loadSessions(); }, [loadProducts, loadSessions]);

  /* --------------------- Persistance du brouillon ---------------------- */
  // Recharge le brouillon « nouveau comptage » depuis localStorage (sert aussi à
  // restaurer ce brouillon en quittant une correction).
  const loadDraftFromStorage = useCallback(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      const o = d ? JSON.parse(d) : null;
      setCounts(o?.counts ?? {});
      setNote(o?.note ?? "");
      const ph = localStorage.getItem(PHOTOS_KEY);
      setPhotos(ph ? (JSON.parse(ph) ?? []) : []);
    } catch { setCounts({}); setNote(""); setPhotos([]); }
  }, []);

  useEffect(() => {
    loadDraftFromStorage();
    hydrated.current = true;
  }, [loadDraftFromStorage]);

  useEffect(() => {
    if (!hydrated.current || editing) return;   // en correction : ne pas écraser le brouillon « neuf »
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ counts, note })); } catch { /* quota */ }
  }, [counts, note, editing]);

  useEffect(() => {
    if (!hydrated.current || editing) return;
    try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos)); } catch { /* quota */ }
  }, [photos, editing]);

  /* ----------------------------- Dérivés ------------------------------- */
  const { families, ordered } = useMemo(() => buildFamilies(products), [products]);
  const productByCode = useMemo(() => new Map(ordered.map((p) => [p.itemCode, p])), [ordered]);
  const setCount = useCallback((itemCode: string, n: number | null) => {
    setCounts((c) => ({ ...c, [itemCode]: n }));
  }, []);

  const countedProducts = useMemo(
    () => ordered.filter((p) => isCounted(counts[p.itemCode])),
    [ordered, counts],
  );
  const countedCount = countedProducts.length;
  const nbEcarts = useMemo(
    () => countedProducts.filter((p) => (ecartOf(counts[p.itemCode], sapInfo(p).qty) ?? 0) !== 0).length,
    [countedProducts, counts],
  );

  // Lignes du récapitulatif = UNION des produits en stock comptés ET des lignes
  // « orphelines » (articles comptés qui ne sont plus dans le stock — possible en
  // correction d'un vieil inventaire). Source unique pour l'affichage du récap ET
  // l'envoi, pour que ce qui est montré == ce qui est enregistré.
  const recapRows = useMemo<RecapRow[]>(() => {
    const editLineByCode = new Map((editing?.lines ?? []).map((l) => [l.itemCode, l] as const));
    const rows: RecapRow[] = [];
    for (const [itemCode, val] of Object.entries(counts)) {
      if (!isCounted(val)) continue;
      const real = val as number;
      const p = productByCode.get(itemCode);
      if (p) {
        const s = sapInfo(p);
        rows.push({ itemCode, itemName: p.itemName, sapQty: s.qty, real, unit: s.unit, ecart: ecartOf(real, s.qty) ?? 0, emoji: fruitEmoji(p), orphan: false });
      } else {
        const el = editLineByCode.get(itemCode);
        if (el) rows.push({ itemCode, itemName: el.itemName, sapQty: el.sapQty, real, unit: el.unit, ecart: Math.round((real - el.sapQty) * 10) / 10, emoji: fruitEmoji({ itemName: el.itemName }), orphan: true });
      }
    }
    // En correction : ordre alphabétique STABLE (les lignes ne sautent pas quand
    // on modifie une quantité). Sinon : écarts les plus forts en tête.
    return rows.sort((a, b) =>
      editing
        ? a.itemName.localeCompare(b.itemName)
        : Math.abs(b.ecart) - Math.abs(a.ecart) || a.itemName.localeCompare(b.itemName),
    );
  }, [counts, productByCode, editing]);
  const nbCountedAll = recapRows.length;            // inclut les lignes hors stock (correction)
  const nbEcartsAll = useMemo(() => recapRows.filter((r) => r.ecart !== 0).length, [recapRows]);

  /* ----------------------------- Actions ------------------------------- */
  const startCount = (list: Product[], label: string) => {
    setScope({ products: list, label, startIndex: firstUncounted(list, counts) });
    setMode("count");
  };

  async function submit() {
    // Lignes envoyées = exactement celles montrées dans le récap (recapRows),
    // y compris les lignes orphelines (article compté qui n'est plus en stock) :
    // ce qui est affiché == ce qui est enregistré.
    const lines: LineDTO[] = recapRows.map((r) => ({
      itemCode: r.itemCode, itemName: r.itemName, sapQty: r.sapQty, realQty: r.real, unit: r.unit, ecart: r.ecart,
    }));
    if (lines.length === 0 && photos.length === 0) {
      toast.error("Ajoute au moins un comptage ou une photo.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = { note, lines, photos: photos.map((p) => ({ id: p.id, dataUrl: p.dataUrl, w: p.w, h: p.h })) };
      const res = await fetch("/api/inventaire", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error(json.error ?? "Erreur"); return; }
      if (editing) {
        toast.success(`Inventaire corrigé — ${json.session.nbEcarts} écart(s)${photos.length ? ` · ${photos.length} photo(s)` : ""}.`, { duration: 6000 });
        setEditing(null);
        loadDraftFromStorage();   // restaure le brouillon « nouveau comptage »
      } else {
        toast.success(
          `Inventaire envoyé — ${json.session.nbEcarts} écart(s)${photos.length ? ` · ${photos.length} photo(s)` : ""} transmis aux administrateurs.`,
          { duration: 8000 },
        );
        setCounts({}); setNote(""); setPhotos([]);
        try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PHOTOS_KEY); } catch { /* ignore */ }
      }
      setMode("home");
      loadSessions();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSubmitting(false); }
  }

  /** Valide (submitted → reviewed) ou rouvre (reviewed → submitted) un inventaire. */
  async function patchSession(id: string, action: "review" | "reopen") {
    const res = await fetch("/api/inventaire", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }),
    });
    if (res.ok) {
      toast.success(action === "reopen" ? "Inventaire rouvert (à revoir)" : "Inventaire marqué comme revu");
      loadSessions();
    } else toast.error("Erreur");
  }

  /** Charge un inventaire existant dans l'éditeur pour le corriger / recompter. */
  async function startEdit(id: string) {
    setLoadingEdit(id);
    try {
      const res = await fetch(`/api/inventaire?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json();
      const s = json.session as SessionDTO | undefined;
      if (!res.ok || !s) { toast.error(json.error ?? "Erreur"); return; }
      const nextCounts: Counts = {};
      for (const l of s.lines) nextCounts[l.itemCode] = l.realQty;
      setEditing(s);
      setCounts(nextCounts);
      setNote(s.note ?? "");
      setPhotos((s.photos ?? []).map((p) => ({ id: p.id, dataUrl: p.dataUrl, w: p.w, h: p.h, bytes: estimateBytes(p.dataUrl) })));
      setMode("recap");
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoadingEdit(null); }
  }

  /** Abandonne la correction en cours et restaure le brouillon « nouveau comptage ». */
  function cancelEdit() {
    setEditing(null);
    loadDraftFromStorage();
    setMode("home");
  }

  async function openSessionPhotos(id: string) {
    if (sessionPhotos[id] && sessionPhotos[id] !== "loading") return;
    setSessionPhotos((m) => ({ ...m, [id]: "loading" }));
    try {
      const res = await fetch(`/api/inventaire?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json();
      setSessionPhotos((m) => ({ ...m, [id]: json.session?.photos ?? [] }));
    } catch {
      setSessionPhotos((m) => ({ ...m, [id]: [] }));
    }
  }

  function resetDraft() {
    setCounts({}); setNote(""); setPhotos([]);
    try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PHOTOS_KEY); } catch { /* ignore */ }
    toast.message("Comptage réinitialisé.");
  }

  /* ============================== RENDER ============================== */
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait">
        {mode === "count" && scope && (
          <motion.div key="count" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <GuidedCounter
              products={scope.products}
              scopeLabel={scope.label}
              counts={counts}
              setCount={setCount}
              startIndex={scope.startIndex}
              onExit={() => setMode(editing ? "recap" : "home")}
              onFinish={() => setMode("recap")}
            />
          </motion.div>
        )}

        {mode === "recap" && (
          <motion.div key="recap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {renderRecap()}
          </motion.div>
        )}

        {mode === "home" && (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-6">
            {renderHome()}
            {renderHistory()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox photo */}
      <AnimatePresence>
        {preview && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPreview(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="aperçu" className="max-h-full max-w-full rounded-lg object-contain" />
            <button
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
              onClick={() => setPreview(null)}
              aria-label="Fermer"
            >
              <X />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  /* ----------------------------- Écran ACCUEIL ----------------------------- */
  function renderHome() {
    const resume = countedCount > 0;
    return (
      <div className="space-y-5">
        {/* Hero / progression */}
        <SurfaceCard accent="brand" className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="kicker !block">Comptage du stock physique</p>
              <h2 className="mt-1 text-[20px] font-bold text-foreground">Inventaire guidé</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                On te propose les produits <b>un par un</b>. Compte, photographie, envoie.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[30px] font-bold leading-none tnum text-foreground">{countedCount}</div>
              <div className="text-[11px] text-muted-foreground">compté(s)</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="En stock" value={products.length} />
            <Stat label="Écarts" value={nbEcarts} tone={nbEcarts > 0 ? "amber" : "muted"} />
            <Stat label="Photos" value={photos.length} tone={photos.length > 0 ? "sky" : "muted"} />
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button size="lg" className="h-12 flex-1 text-[15px]" onClick={() => startCount(ordered, "Inventaire complet")}>
              <ScanLine className="!size-5" />
              {resume ? "Reprendre le comptage" : "Commencer l'inventaire"}
              <ChevronRight className="!size-5" />
            </Button>
            {(countedCount > 0 || photos.length > 0) && (
              <Button size="lg" variant="success" className="h-12 text-[15px]" onClick={() => setMode("recap")}>
                <Send className="!size-4" /> Finaliser & envoyer
              </Button>
            )}
          </div>
          {resume && (
            <button onClick={resetDraft} className="mt-3 text-[12px] text-muted-foreground hover:text-foreground">
              Réinitialiser le comptage en cours
            </button>
          )}
        </SurfaceCard>

        {/* Familles — « petit à petit » */}
        <SurfaceCard accent="sky" className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <ClipboardList className="h-4 w-4 text-muted-foreground" /> Compter par famille
          </h3>
          {families.length === 0 ? (
            <p className="py-2 text-[12px] italic text-muted-foreground">Aucun produit en stock.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {families.map((f) => {
                const done = f.products.filter((p) => isCounted(counts[p.itemCode])).length;
                const complete = done >= f.products.length && f.products.length > 0;
                return (
                  <button
                    key={f.key}
                    onClick={() => startCount(f.products, `${f.emoji} ${f.name}`)}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-brand-400 hover:shadow-sm active:scale-[0.98]"
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-[24px] leading-none">
                      {f.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-foreground">{f.name}</div>
                      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground tnum">
                        {complete ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <PackageCheck className="h-3.5 w-3.5" /> {f.products.length} OK
                          </span>
                        ) : (
                          <span>{done}/{f.products.length} compté(s)</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-brand-500" />
                  </button>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </div>
    );
  }

  /* ----------------------------- Écran RÉCAP ----------------------------- */
  function renderRecap() {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => (editing ? cancelEdit() : setMode("home"))} aria-label="Retour">
            <ChevronLeft />
          </Button>
          <div className="flex-1">
            <h2 className="text-[18px] font-bold text-foreground">
              {editing ? "Correction de l'inventaire" : "Récapitulatif"}
            </h2>
            <p className="text-[12px] text-muted-foreground tnum">
              {editing
                ? `${fmtDate(editing.createdAt)} · ${editing.createdBy}`
                : `${nbCountedAll} article(s) · ${nbEcartsAll} écart(s) · ${photos.length} photo(s)`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => startCount(ordered, "Inventaire complet")} className="gap-1.5">
            <Pencil className="!size-3.5" /> Continuer
          </Button>
        </div>

        {editing && (
          <div className="rounded-xl border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-900/15 px-4 py-2.5 text-[12.5px] text-sky-800 dark:text-sky-300">
            Vous repassez sur cet inventaire. L&apos;enregistrement <b>remplace</b> le comptage existant
            et le repasse en <b>« à revoir »</b>.
          </div>
        )}

        {/* Lignes comptées (produits en stock + lignes hors stock d'une correction).
            En correction : chaque quantité réelle est éditable DIRECTEMENT ici. */}
        <SurfaceCard accent="sky" className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-foreground">
              Articles comptés {recapRows.length > 0 && <span className="text-muted-foreground tnum font-normal">· {recapRows.length}</span>}
            </h3>
            {editing && recapRows.length > 0 && (
              <span className="text-[11px] text-muted-foreground">Modifie les quantités réelles ci-dessous</span>
            )}
          </div>
          {recapRows.length === 0 ? (
            <p className="py-2 text-[12px] italic text-muted-foreground">
              {editing
                ? "Aucune ligne — utilise « Continuer » pour compter des articles."
                : "Rien de compté pour l'instant — tu peux n'envoyer que des photos."}
            </p>
          ) : (
            <div className={`-mx-1 divide-y divide-border/60 overflow-y-auto ${editing ? "max-h-[60vh]" : "max-h-[44vh]"}`}>
              {recapRows.map((r) => (
                <div key={r.itemCode} className="flex items-center gap-2.5 px-1 py-2">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-[18px] leading-none">
                    {r.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-foreground">{r.itemName}</span>
                      {r.orphan && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground" title="Article qui n'est plus listé en stock SAP">
                          hors stock
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground tnum">
                      {editing ? (
                        <>SAP {fmt(r.sapQty)} {r.unit}</>
                      ) : (
                        <>SAP {fmt(r.sapQty)} → réel <b className="text-foreground">{fmt(r.real)}</b> {r.unit}</>
                      )}
                    </div>
                  </div>

                  {editing && (
                    <NumberInput
                      value={(counts[r.itemCode] ?? 0) as number}
                      onValueChange={(n) => setCount(r.itemCode, n)}
                      min={0}
                      step={1}
                      aria-label={`Quantité réelle — ${r.itemName}`}
                      className="h-9 w-[68px] shrink-0 rounded-lg border-border bg-background px-1 text-center text-[14px] font-semibold tnum text-foreground"
                    />
                  )}

                  <span className={`shrink-0 ${editing ? "w-12 text-right" : ""} text-[13px] font-bold tnum ${r.ecart === 0 ? "text-emerald-600 dark:text-emerald-400" : r.ecart > 0 ? "text-sky-600 dark:text-sky-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {r.ecart === 0 ? "OK" : r.ecart > 0 ? `+${fmt(r.ecart)}` : fmt(r.ecart)}
                  </span>
                  <button onClick={() => setCount(r.itemCode, null)} className="shrink-0 text-muted-foreground/60 hover:text-rose-500" aria-label="Retirer la ligne">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Photos de l'entrepôt */}
        <SurfaceCard accent="violet" className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Camera className="h-4 w-4 text-muted-foreground" /> Photos de l&apos;entrepôt
            <span className="ml-auto text-[11.5px] font-normal text-muted-foreground">jusqu&apos;à {MAX_PHOTOS}</span>
          </h3>
          <PhotoStep photos={photos} onChange={setPhotos} onPreview={setPreview} />
        </SurfaceCard>

        {/* Note + envoi */}
        <SurfaceCard accent="amber" className="p-5 space-y-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note pour les administrateurs (zone, remarque, anomalie…) — optionnel"
            className="min-h-[64px]"
          />
          <Button onClick={submit} disabled={submitting || (nbCountedAll === 0 && photos.length === 0)} size="lg" className="h-12 w-full text-[15px]">
            {submitting ? <Loader2 className="animate-spin" /> : editing ? <Save className="!size-5" /> : <Send className="!size-5" />}
            {editing ? "Enregistrer la correction" : "Envoyer l'inventaire"}
          </Button>
          {editing && (
            <Button onClick={cancelEdit} variant="ghost" disabled={submitting} className="w-full text-[13px] text-muted-foreground">
              Annuler la correction
            </Button>
          )}
        </SurfaceCard>
      </div>
    );
  }

  /* ----------------------------- Historique ----------------------------- */
  function renderHistory() {
    return (
      <SurfaceCard accent="amber" className="p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" /> États d&apos;inventaire {canManage ? "" : "(les miens)"}
        </h2>
        {sessions.length === 0 && <p className="py-2 text-[12px] italic text-muted-foreground">Aucun inventaire pour l&apos;instant.</p>}
        <div className="space-y-2">
          {sessions.map((s) => {
            const ecarts = s.lines.filter((l) => Math.abs(l.ecart) > 0.001);
            const nbPhotos = s.nbPhotos ?? s.photos?.length ?? 0;
            const loaded = sessionPhotos[s.id];
            return (
              <div key={s.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground">{fmtDate(s.createdAt)} · {s.createdBy}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {s.lines.length} article(s) · {s.nbEcarts} écart(s)
                      {nbPhotos > 0 ? ` · ${nbPhotos} photo(s)` : ""}{s.note ? ` · « ${s.note} »` : ""}
                    </div>
                    {s.status === "reviewed" && s.reviewedBy && (
                      <div className="text-[11px] text-emerald-600/90 dark:text-emerald-400/90">Revu par {s.reviewedBy}</div>
                    )}
                    {s.updatedBy && (
                      <div className="text-[11px] text-sky-600/90 dark:text-sky-400/90">Dernière correction par {s.updatedBy}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {s.status === "reviewed" ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> revu</span>
                    ) : (
                      <span className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">à revoir</span>
                    )}
                    {canManage && (
                      <>
                        {s.status === "submitted" ? (
                          <Button size="sm" variant="outline" onClick={() => patchSession(s.id, "review")}>
                            <CheckCircle2 className="!size-3.5" /> Marquer revu
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => patchSession(s.id, "reopen")}>
                            <RotateCcw className="!size-3.5" /> Rouvrir
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={loadingEdit === s.id} onClick={() => startEdit(s.id)}>
                          {loadingEdit === s.id ? <Loader2 className="!size-3.5 animate-spin" /> : <Pencil className="!size-3.5" />} Corriger
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {ecarts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                    {ecarts.map((l) => (
                      <span key={l.itemCode} className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11.5px] text-amber-700 dark:text-amber-300">
                        <span className="font-mono">{l.itemCode}</span>
                        <span className="text-muted-foreground">SAP {fmt(l.sapQty)} → {fmt(l.realQty)}</span>
                        <b className="tnum">{l.ecart > 0 ? `+${fmt(l.ecart)}` : fmt(l.ecart)} {l.unit}</b>
                      </span>
                    ))}
                  </div>
                )}

                {nbPhotos > 0 && (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    {!loaded ? (
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openSessionPhotos(s.id)}>
                        <ImageIcon className="!size-3.5" /> Voir les {nbPhotos} photo(s)
                      </Button>
                    ) : loaded === "loading" ? (
                      <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {loaded.map((ph) => (
                          <button key={ph.id} onClick={() => setPreview(ph.dataUrl)} className="h-16 w-16 overflow-hidden rounded-lg border border-border transition active:scale-95">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ph.dataUrl} alt="photo" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SurfaceCard>
    );
  }
}

/* ----------------------------- Petits blocs ----------------------------- */
function Stat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "amber" | "sky" }) {
  const color =
    tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : tone === "sky" ? "text-sky-600 dark:text-sky-400"
    : "text-foreground";
  return (
    <div className="rounded-xl bg-muted/50 py-2">
      <div className={`text-[20px] font-bold leading-none tnum ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
