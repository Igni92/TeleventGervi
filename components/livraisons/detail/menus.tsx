"use client";

// Menus contextuels (clic droit) + outil de ligne (changer le lot / échanger
// l'article) du détail livraison. Restyle refonte : tokens (card / hairline /
// états sémantiques), échelle typo fermée — comportement inchangé. Le clic
// droit RESTE le raccourci power-user ; chaque action existe aussi dans un
// menu « ⋯ » visible (CarrierGroup / OrderRow).
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, Truck, BadgeEuro, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { StarRating } from "@/components/ui/star-rating";

/* ═════════════════════════════════════════════════════════════
   Outil de ligne (clic droit sur une ligne produit) — deux actions, modif SAP
   DIRECTE via /api/sap/orders/[docEntry]/modif (même endpoint que la console,
   sans passer par elle → rapide) :
     • CHANGER LE LOT   : liste FIFO enrichie (fournisseur · prix · colis restant
       · étoiles) ; le lot choisi est posé sur la/les ligne(s) de l'article et le
       magasin est aligné sur celui du lot ;
     • ÉCHANGER L'ARTICLE : remplace le code par un autre (nouveau lot FIFO résolu
       côté serveur), quantité et prix conservés.
   On recharge le bon complet et on renvoie TOUTES les lignes (reconstruction).
═════════════════════════════════════════════════════════════ */
interface SwapProduct { itemCode: string; itemName: string }
interface SwapSrcLine {
  lineNum: number; itemCode: string; qtyPieces: number;
  price: number | null; warehouse: string | null; lot: string | null; closed: boolean;
}
interface LotCand {
  lot: string; docNum: number; warehouse: string | null; affect: string;
  qty?: number | null; colis?: number | null; fromLedger?: boolean;
  supplierName?: string | null; purchasePrice?: number | null; currency?: string | null;
  rating?: number | null;
}
const LOT_AFFECT_LABEL: Record<string, string> = { TOUS: "Tous", EXPORT: "Export", GMS: "GMS", CHR: "CHR" };
const fmtColisLot = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

/** Normalise une saisie de lot : « 23568 » → « EM23568 ». Une saisie déjà
 *  préfixée (EM…) ou un sentinel (EM_PENDING, EM_FAM:…) est conservé tel quel. */
export function normalizeLotInput(raw: string): string {
  const v = raw.trim().toUpperCase();
  if (!v) return "";
  return /^\d+$/.test(v) ? `EM${v}` : v;
}

/**
 * Pose `lot` sur TOUTES les lignes de `itemCode` d'un bon, en réécrivant le
 * document (les autres lignes sont conservées à l'identique). `warehouse` non
 * null aligne le magasin sur celui du lot ; null garde celui de la ligne.
 *
 * Partagé par le menu de ligne (clic droit) et la colonne « Lot » éditable du
 * tableau, pour que les deux chemins appliquent EXACTEMENT les mêmes garde-fous
 * (article introuvable, ligne déjà livrée → lot verrouillé).
 */
export async function applyLotChange(
  docEntry: number, itemCode: string, lot: string, warehouse: string | null,
): Promise<void> {
  const g = await fetch(`/api/sap/orders/${docEntry}/modif`, { cache: "no-store" }).then((r) => r.json());
  // L'endpoint renvoie `cartLines` (pas `lines`) — sinon changement de lot et
  // échange d'article échouaient toujours (« Chargement du bon impossible »).
  if (!g?.ok || !Array.isArray(g.cartLines)) throw new Error(g?.error || "Chargement du bon impossible");
  const src = g.cartLines as SwapSrcLine[];
  const targets = src.filter((l) => l.itemCode === itemCode);
  if (targets.length === 0) throw new Error("Article introuvable sur ce bon");
  if (targets.some((l) => l.closed)) throw new Error("Article déjà livré — lot verrouillé");
  const lines = src.map((l) => l.itemCode === itemCode
    ? { itemCode: l.itemCode, quantity: l.qtyPieces, warehouseCode: (warehouse ?? l.warehouse) ?? undefined, price: l.price ?? undefined, keep: true, lot }
    : { itemCode: l.itemCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: true, lot: l.lot ?? undefined });
  const res = await fetch(`/api/sap/orders/${docEntry}/modif`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }),
  }).then((r) => r.json());
  if (!res?.ok) throw new Error(res?.error || "Échec du changement de lot");
}

export function LineToolMenu({ docEntry, docNum, pos, onClose, onDone }: {
  docEntry: number;
  docNum: number;
  pos: { x: number; y: number; oldCode: string; oldName: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"lot" | "article">("lot");
  // Mode LOT : candidats FIFO enrichis pour cet article.
  const [cands, setCands] = useState<LotCand[] | null>(null);
  const [lotBusy, setLotBusy] = useState<string | null>(null);
  const [manual, setManual] = useState("");   // saisie manuelle d'un n° d'EM
  // Mode ARTICLE : recherche produit (échange).
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SwapProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Candidats de lot (FIFO, fournisseur/prix/colis/étoiles) — chargés une fois.
  useEffect(() => {
    let cancelled = false;
    setCands(null);
    fetch(`/api/lots/candidates?items=${encodeURIComponent(pos.oldCode)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { items?: Record<string, { candidates?: LotCand[] }> }) => {
        if (!cancelled) setCands(j?.items?.[pos.oldCode]?.candidates ?? []);
      })
      .catch(() => { if (!cancelled) setCands([]); });
    return () => { cancelled = true; };
  }, [pos.oldCode]);

  // Recherche produit débouncée (≥ 2 car.) — uniquement en mode article.
  useEffect(() => {
    if (mode !== "article") return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/products?search=${encodeURIComponent(q)}&limit=12`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { products?: SwapProduct[] }) => { if (my === seq.current) setResults(j.products ?? []); })
        .catch(() => { if (my === seq.current) setResults([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 220);
    return () => clearTimeout(h);
  }, [query, mode]);

  // Fermeture : clic hors zone / Escape. `composedPath()` plutôt que `.contains()`
  // sur `e.target` (plus fiable pour un panneau en portail séparé) ; `pointerdown`
  // pour matcher l'évènement écouté par Radix (Dialog englobant).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !e.composedPath().includes(boxRef.current)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  // Charge les lignes du bon (via l'endpoint de modif) pour reconstruction.
  async function loadSrc(): Promise<SwapSrcLine[]> {
    const g = await fetch(`/api/sap/orders/${docEntry}/modif`, { cache: "no-store" }).then((r) => r.json());
    // L'endpoint renvoie `cartLines` (pas `lines`) — sinon changement de lot et
    // échange d'article échouaient toujours (« Chargement du bon impossible »).
    if (!g?.ok || !Array.isArray(g.cartLines)) throw new Error(g?.error || "Chargement du bon impossible");
    return g.cartLines as SwapSrcLine[];
  }

  // CHANGER LE LOT : pose le lot choisi sur la/les ligne(s) de l'article et aligne
  // le magasin sur celui du lot (les autres lignes conservées à l'identique).
  // `warehouse` null (saisie manuelle) → on garde le magasin de la ligne.
  async function runLotChange(lot: string, warehouse: string | null) {
    if (lotBusy || busy) return;
    setLotBusy(lot);
    try {
      // Logique partagée avec la colonne « Lot » éditable du tableau, pour que
      // les deux chemins appliquent les mêmes garde-fous (cf. applyLotChange).
      await applyLotChange(docEntry, pos.oldCode, lot, warehouse);
      toast.success(`Lot → ${lot}`, { description: `BL n°${docNum} · ${pos.oldName}` });
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec du changement de lot");
    } finally {
      setLotBusy(null);
    }
  }

  // ÉCHANGER L'ARTICLE : l'ancien article → le nouveau (nouveau lot résolu,
  // keep:false) ; les autres lignes conservées telles quelles (lot d'origine).
  async function runSwap(p: SwapProduct) {
    if (busy || lotBusy) return;
    if (p.itemCode === pos.oldCode) { onClose(); return; }
    setBusy(p.itemCode);
    try {
      const src = await loadSrc();
      const targets = src.filter((l) => l.itemCode === pos.oldCode);
      if (targets.length === 0) throw new Error("Article introuvable sur ce bon");
      if (targets.some((l) => l.closed)) throw new Error("Article déjà livré — échange impossible");
      if (src.some((l) => l.itemCode === p.itemCode)) { toast.info(`${p.itemName} est déjà sur ce bon`); return; }
      const lines = src.map((l) => l.itemCode === pos.oldCode
        ? { itemCode: p.itemCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: false }
        : { itemCode: l.itemCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: true, lot: l.lot ?? undefined });
      const res = await fetch(`/api/sap/orders/${docEntry}/modif`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }),
      }).then((r) => r.json());
      if (!res?.ok) throw new Error(res?.error || "Échec de l'échange");
      toast.success(`${pos.oldName} → ${p.itemName}`, { description: `BL n°${docNum} · quantité et prix conservés.` });
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'échange");
    } finally {
      setBusy(null);
    }
  }

  const tabBtn = (m: "lot" | "article", label: string) => (
    <button type="button" onClick={() => setMode(m)}
      className={`flex-1 h-6 rounded-md text-caption2 font-semibold transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] ${
        mode === m ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
      }`}>
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={boxRef}
      data-linetool=""
      data-floating-root=""
      style={{ position: "fixed", left: pos.x, top: pos.y, width: 300 }}
      onContextMenu={(e) => e.preventDefault()}
      // Le popup est rendu dans un portail MAIS reste enfant React de la carte :
      // sans ça, un clic dedans REMONTE (arbre React) jusqu'au onClick de la
      // carte, qui refermait la fenêtre. On coupe la propagation ici.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // `pointer-events-auto` OBLIGATOIRE : quand ce menu est ouvert AU-DESSUS de
      // la modale de préparation (Radix Dialog), Radix pose `pointer-events:none`
      // sur <body> — dont ce popup hérite (porté dans <body>). Sans ça, les clics
      // gauche TRAVERSENT le popup jusqu'à l'overlay derrière, et son propre
      // détecteur de « clic dehors » le refermait à chaque clic intérieur.
      className="pointer-events-auto z-[130] rounded-xl bg-card shadow-modal ring-1 ring-border overflow-hidden flex flex-col max-h-[360px] animate-fade-up"
    >
      <div className="shrink-0 px-3 py-2 border-b border-border bg-secondary/30">
        <p className="text-caption2 text-muted-foreground truncate">
          <span className="font-semibold text-foreground">{pos.oldName}</span> <span className="font-mono">{pos.oldCode}</span>
        </p>
        <div className="mt-1.5 flex items-center gap-0.5 rounded-lg ring-1 ring-border bg-secondary/40 p-0.5">
          {tabBtn("lot", "Changer le lot")}
          {tabBtn("article", "Échanger l'article")}
        </div>
      </div>

      {mode === "lot" ? (
        <>
        <div className="overflow-y-auto py-1 min-h-0">
          <p className="px-3 pt-1 pb-0.5 text-caption2 uppercase tracking-wider text-muted-foreground font-semibold">Lots — ordre FIFO</p>
          {cands === null ? (
            <p className="px-3 py-2 text-caption text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des lots…</p>
          ) : cands.length === 0 ? (
            <p className="px-3 py-2 text-caption italic text-muted-foreground">Aucun lot en stock pour cet article.</p>
          ) : cands.map((c) => (
            <button key={c.lot} type="button" disabled={lotBusy != null} onClick={() => runLotChange(c.lot, c.warehouse)}
              className="w-full text-left px-3 py-1.5 hover:bg-secondary/60 disabled:opacity-60 transition-colors">
              <div className="flex items-center gap-1.5 text-caption">
                <span className="font-semibold text-foreground">{c.lot}</span>
                <span className="text-caption2 px-1 py-px rounded-sm bg-secondary text-muted-foreground">{LOT_AFFECT_LABEL[c.affect] ?? c.affect}</span>
                {c.rating ? <StarRating value={c.rating} size="sm" /> : null}
                <span className="ml-auto shrink-0">
                  {lotBusy === c.lot ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : c.fromLedger && c.colis != null && c.colis > 0 ? (
                    <span className="text-caption2 px-1.5 py-px rounded-sm bg-secondary text-foreground font-semibold tnum" title="Colis restants sur cette entrée">{fmtColisLot(c.colis)} colis</span>
                  ) : c.qty != null && c.qty > 0 ? (
                    <span className="text-caption2 px-1 py-px rounded-sm bg-success/12 text-success tnum" title="Stock physique de l'article dans cet entrepôt">{Math.round(c.qty)} en stock</span>
                  ) : null}
                </span>
              </div>
              {(c.supplierName || (c.purchasePrice != null && c.purchasePrice > 0) || c.warehouse) && (
                <div className="mt-0.5 flex items-center gap-x-2.5 flex-wrap text-caption2 text-muted-foreground tnum">
                  {c.supplierName && <span className="inline-flex items-center gap-1 min-w-0"><Truck className="h-3 w-3 shrink-0" /> <span className="truncate">{c.supplierName}</span></span>}
                  {c.purchasePrice != null && c.purchasePrice > 0 && <span className="inline-flex items-center gap-1"><BadgeEuro className="h-3 w-3" /> {c.purchasePrice.toFixed(2)} €</span>}
                  {c.warehouse && <span className="ml-auto">mag. {c.warehouse}</span>}
                </div>
              )}
            </button>
          ))}
        </div>
        {/* Saisie manuelle : je tape les chiffres, ça pose « EM<chiffres> ». */}
        <div className="shrink-0 border-t border-border bg-secondary/30 px-2.5 py-2">
          <label className="block text-caption2 uppercase tracking-wider text-muted-foreground font-semibold mb-1">Ou saisir le n° d&apos;entrée</label>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center h-7 pl-2 pr-1 rounded-l-md border border-r-0 border-border bg-card text-caption font-semibold text-muted-foreground select-none">EM</span>
            <input
              type="text"
              inputMode="numeric"
              value={manual}
              onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && manual && lotBusy == null) { e.preventDefault(); runLotChange(`EM${manual}`, null); } }}
              placeholder="23568"
              className="h-7 flex-1 min-w-0 rounded-none border border-border bg-background px-2 text-caption tnum focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              disabled={!manual || lotBusy != null}
              onClick={() => manual && runLotChange(`EM${manual}`, null)}
              className="h-7 shrink-0 rounded-r-md bg-primary px-2.5 text-caption font-semibold text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[color-mix(in_srgb,hsl(var(--primary))_92%,black)]"
            >
              {lotBusy === `EM${manual}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "OK"}
            </button>
          </div>
        </div>
        </>
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
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-caption focus:outline-none focus:ring-2 focus:ring-ring"
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
                disabled={busy != null}
                onClick={() => runSwap(p)}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-60 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-caption font-medium text-foreground truncate">{p.itemName}</span>
                  <span className="block text-caption2 font-mono text-muted-foreground">{p.itemCode}</span>
                </span>
                {busy === p.itemCode
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                  : <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

/* ═════════════════════════════════════════════════════════════
   Menu contextuel (clic droit) — scaffolding partagé transporteur / ligne :
   état de position, ouverture clampée à l'écran, fermeture (clic hors zone,
   Escape, scroll, resize) et rendu portalisé dans <body>.
═════════════════════════════════════════════════════════════ */
export function useContextMenu(clampW = 220, clampH = 96) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const openAt = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - clampW), y: Math.min(e.clientY, window.innerHeight - clampH) });
  }, [clampW, clampH]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);
  return { menu, openAt, close };
}

/** Conteneur portalisé du menu contextuel : backdrop de fermeture + panneau
 *  positionné. `header` optionnel (titre du groupe), `children` = les items. */
export function ContextMenu({
  menu, onClose, minWidth = 210, header, children,
}: {
  menu: { x: number; y: number } | null;
  onClose: () => void;
  minWidth?: number;
  header?: ReactNode;
  children: ReactNode;
}) {
  if (!menu || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        data-floating-root=""
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        role="menu"
        data-floating-root=""
        className="fixed z-50 overflow-hidden rounded-lg bg-card ring-1 ring-border py-1 shadow-modal animate-fade-up"
        style={{ top: menu.y, left: menu.x, minWidth }}
      >
        {header}
        {children}
      </div>
    </>,
    document.body,
  );
}

/** Élément de menu contextuel — icône + libellé, coche si état courant.
 *  Icône neutre par défaut (couleur = état uniquement, via `accent`). */
export function MenuItem({
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
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-foreground hover:bg-secondary/60 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)]"
    >
      <Icon className={`h-4 w-4 shrink-0 ${accent ?? "text-muted-foreground"}`} />
      <span className="flex-1">{children}</span>
      {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-foreground/50" />}
    </button>
  );
}
