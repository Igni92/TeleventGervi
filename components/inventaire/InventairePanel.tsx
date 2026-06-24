"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, Send, CheckCircle2, AlertTriangle, ClipboardList, Camera, ChevronRight,
  ChevronLeft, Pencil, X, ImageIcon, ScanLine, PackageCheck,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
  reviewedAt: string | null; reviewedBy: string | null; nbPhotos?: number;
};

type Counts = Record<string, number | null>;
type Mode = "home" | "count" | "recap";
type Scope = { products: Product[]; label: string; startIndex: number };

const DRAFT_KEY = "tv-inv-draft-v2";
const PHOTOS_KEY = "tv-inv-photos-v2";

const isCounted = (v: number | null | undefined) => v != null && Number.isFinite(v);
const firstUncounted = (list: Product[], counts: Counts) => {
  const i = list.findIndex((p) => !isCounted(counts[p.itemCode]));
  return i < 0 ? 0 : i;
};

export function InventairePanel({ isAdmin }: { isAdmin: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Brouillon (persisté localStorage)
  const [counts, setCounts] = useState<Counts>({});
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const hydrated = useRef(false);

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
  useEffect(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d) { const o = JSON.parse(d); setCounts(o.counts ?? {}); setNote(o.note ?? ""); }
      const ph = localStorage.getItem(PHOTOS_KEY);
      if (ph) setPhotos(JSON.parse(ph) ?? []);
    } catch { /* ignore */ }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ counts, note })); } catch { /* quota */ }
  }, [counts, note]);

  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos)); } catch { /* quota */ }
  }, [photos]);

  /* ----------------------------- Dérivés ------------------------------- */
  const { families, ordered } = useMemo(() => buildFamilies(products), [products]);
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

  /* ----------------------------- Actions ------------------------------- */
  const startCount = (list: Product[], label: string) => {
    setScope({ products: list, label, startIndex: firstUncounted(list, counts) });
    setMode("count");
  };

  async function submit() {
    const lines: LineDTO[] = countedProducts.map((p) => {
      const s = sapInfo(p);
      const real = counts[p.itemCode] as number;
      return { itemCode: p.itemCode, itemName: p.itemName, sapQty: s.qty, realQty: real, unit: s.unit, ecart: ecartOf(real, s.qty) ?? 0 };
    });
    if (lines.length === 0 && photos.length === 0) {
      toast.error("Ajoute au moins un comptage ou une photo.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, lines, photos: photos.map((p) => ({ id: p.id, dataUrl: p.dataUrl, w: p.w, h: p.h })) }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error(json.error ?? "Erreur"); return; }
      toast.success(
        `Inventaire envoyé — ${json.session.nbEcarts} écart(s)${photos.length ? ` · ${photos.length} photo(s)` : ""} transmis aux administrateurs.`,
        { duration: 8000 },
      );
      setCounts({}); setNote(""); setPhotos([]);
      try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PHOTOS_KEY); } catch { /* ignore */ }
      setMode("home");
      loadSessions();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSubmitting(false); }
  }

  async function review(id: string) {
    const res = await fetch("/api/inventaire", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (res.ok) { toast.success("Inventaire marqué comme revu"); loadSessions(); }
    else toast.error("Erreur");
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
              onExit={() => setMode("home")}
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
    const lines = [...countedProducts].sort((a, b) => {
      const ea = Math.abs(ecartOf(counts[a.itemCode], sapInfo(a).qty) ?? 0);
      const eb = Math.abs(ecartOf(counts[b.itemCode], sapInfo(b).qty) ?? 0);
      return eb - ea || a.itemName.localeCompare(b.itemName);
    });
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setMode("home")} aria-label="Retour">
            <ChevronLeft />
          </Button>
          <div className="flex-1">
            <h2 className="text-[18px] font-bold text-foreground">Récapitulatif</h2>
            <p className="text-[12px] text-muted-foreground tnum">
              {countedCount} article(s) · {nbEcarts} écart(s) · {photos.length} photo(s)
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => startCount(ordered, "Inventaire complet")} className="gap-1.5">
            <Pencil className="!size-3.5" /> Continuer
          </Button>
        </div>

        {/* Lignes comptées */}
        <SurfaceCard accent="sky" className="p-4">
          <h3 className="mb-2 text-[13px] font-semibold text-foreground">Articles comptés</h3>
          {lines.length === 0 ? (
            <p className="py-2 text-[12px] italic text-muted-foreground">
              Rien de compté pour l&apos;instant — tu peux n&apos;envoyer que des photos.
            </p>
          ) : (
            <div className="-mx-1 max-h-[44vh] divide-y divide-border/60 overflow-y-auto">
              {lines.map((p) => {
                const s = sapInfo(p);
                const real = counts[p.itemCode] as number;
                const ec = ecartOf(real, s.qty) ?? 0;
                return (
                  <div key={p.id} className="flex items-center gap-3 px-1 py-2">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-[18px] leading-none">
                      {fruitEmoji(p)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-foreground">{p.itemName}</div>
                      <div className="text-[11.5px] text-muted-foreground tnum">
                        SAP {fmt(s.qty)} → réel <b className="text-foreground">{fmt(real)}</b> {s.unit}
                      </div>
                    </div>
                    <span className={`shrink-0 text-[13px] font-bold tnum ${ec === 0 ? "text-emerald-600 dark:text-emerald-400" : ec > 0 ? "text-sky-600 dark:text-sky-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {ec === 0 ? "OK" : ec > 0 ? `+${fmt(ec)}` : fmt(ec)}
                    </span>
                    <button onClick={() => setCount(p.itemCode, null)} className="shrink-0 text-muted-foreground/60 hover:text-rose-500" aria-label="Retirer">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
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
          <Button onClick={submit} disabled={submitting || (countedCount === 0 && photos.length === 0)} size="lg" className="h-12 w-full text-[15px]">
            {submitting ? <Loader2 className="animate-spin" /> : <Send className="!size-5" />}
            Envoyer l&apos;inventaire
          </Button>
        </SurfaceCard>
      </div>
    );
  }

  /* ----------------------------- Historique ----------------------------- */
  function renderHistory() {
    return (
      <SurfaceCard accent="amber" className="p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" /> États d&apos;inventaire {isAdmin ? "" : "(les miens)"}
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
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.status === "reviewed" ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> revu</span>
                    ) : (
                      <span className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">à revoir</span>
                    )}
                    {isAdmin && s.status === "submitted" && (
                      <Button size="sm" variant="outline" onClick={() => review(s.id)}>Marquer revu</Button>
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
