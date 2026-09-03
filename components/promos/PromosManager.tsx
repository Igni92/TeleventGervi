"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BadgePercent, Gift, Loader2, PackagePlus, Plus, RefreshCw, Search, Store, Tag, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { composePriceLabel, fmtPrix, storeTypeLabel } from "@/components/promos/promo-utils";
import { designationProduit } from "@/lib/produit-designation";
import { DesignationChips } from "@/components/entrees/DesignationChips";
import { SEGMENT_BADGE } from "@/lib/segments";
import { cn } from "@/lib/utils";

/**
 * Gestion des promos articles (C2) — liste + création + désactivation/suppression.
 * Les promos ACTIVES remontent sur la Console Écran 2 : badge sur la liste stock,
 * remise auto à l'ajout au panier, mention « PROMO : … » en en-tête du bon SAP.
 *
 * Contrat /api/promos (construit en parallèle) — codé défensivement :
 *   GET            → { promos: [{ id, itemCode, kind, value, buyQty, freeQty, label }] }
 *   POST           → création ; PATCH /api/promos/[id] ({ active:false } pour désactiver) ;
 *   DELETE /api/promos/[id].
 */

type PromoKind = "PERCENT" | "X_PLUS_Y" | "FREE" | "PRICE";

interface Promo {
  id: string;
  itemCode: string;
  kind: PromoKind;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  label: string | null;
  /** argumentaire commercial court — affiché dans le bandeau PromoBanner */
  pitch?: string | null;
  /** type de magasin ciblé (EXPORT | GMS | CHR) — null = tous les magasins */
  storeType?: string | null;
  // Champs optionnels (selon implémentation serveur) — tolérés, jamais requis
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  itemName?: string | null;
  // Tags produit résolus par l'API (LEFT JOIN "Product")
  marque?: string | null;
  pays?: string | null;
  condi?: string | null;
  variete?: string | null;
  calibre?: string | null;
}

interface ProductHit {
  itemCode: string; itemName: string; groupName: string | null;
  marque: string | null; pays: string | null; condi: string | null; variete: string | null; calibre: string | null;
}

/** Types de magasin ciblables + « Tous ». */
const STORE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Tous" },
  { value: "EXPORT", label: "Export" },
  { value: "GMS", label: "GMS" },
  { value: "CHR", label: "CHR" },
];

/** Libellé court du type : « −10 % », « 5+1 », « +1 offert » ou « 2,80 € ». */
function promoBadge(p: Promo): string {
  if (p.kind === "PERCENT") return `−${String(Math.round((p.value ?? 0) * 100) / 100)} %`;
  if (p.kind === "PRICE") return fmtPrix(p.value);
  if (p.kind === "FREE") { const n = p.freeQty ?? 1; return `+${n} offert${n > 1 ? "s" : ""}`; }
  return `${p.buyQty ?? "?"}+${p.freeQty ?? "?"}`;
}

function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR");
}

/** Jours entiers restants avant une date de fin (null si absente/passée-invalide). */
function joursRestants(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const finJour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
  return Math.ceil((finJour - Date.now()) / 86_400_000);
}

export function PromosManager() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  // Suppression confirmée par ConfirmDialog (jamais window.confirm).
  const [deleteTarget, setDeleteTarget] = useState<Promo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/promos", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setPromos((json?.promos ?? []) as Promo[]);
    } catch { setPromos([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Bascule Actif/Inactif (mise à jour optimiste, rollback au besoin). */
  const setActive = async (p: Promo, next: boolean) => {
    setPromos((cur) => cur.map((x) => (x.id === p.id ? { ...x, active: next } : x)));
    try {
      const res = await fetch(`/api/promos/${p.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? "Promo réactivée" : "Promo désactivée");
    } catch {
      setPromos((cur) => cur.map((x) => (x.id === p.id ? { ...x, active: !next } : x)));
      toast.error("Échec de la mise à jour");
    }
  };

  const confirmRemove = async () => {
    const p = deleteTarget;
    if (!p) return;
    const res = await fetch(`/api/promos/${p.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Échec de la suppression"); throw new Error("delete"); }
    toast.success("Promo supprimée");
    setPromos((cur) => cur.filter((x) => x.id !== p.id));
  };

  const actives = promos.filter((p) => p.active ?? true);
  const inactives = promos.filter((p) => !(p.active ?? true));

  /** Carte d'une promo — badge héros à gauche, statut + suppression à droite. */
  const renderCard = (p: Promo) => {
    const active = p.active ?? true;
    const debut = fmtDate(p.startsAt);
    const fin = fmtDate(p.endsAt);
    const restants = joursRestants(p.endsAt);
    // Échéance PROCHE : accent d'alerte quand il reste 3 jours ou moins.
    const proche = restants != null && restants >= 0 && restants <= 3;
    const dz = designationProduit({
      itemName: p.itemName, uPays: p.pays, uMarque: p.marque, uCondi: p.condi, uVariete: p.variete, uCalibre: p.calibre,
    });
    // Cible magasin : affichée uniquement si RESTREINTE (Export/GMS/CHR).
    const storeChip = p.storeType ? SEGMENT_BADGE[p.storeType] ?? null : null;
    return (
      <li
        key={p.id}
        className={cn(
          "rounded-xl border border-border bg-card p-3.5 flex flex-wrap items-start gap-3.5 shadow-card",
          !active && "opacity-60",
        )}
      >
        {/* Badge promo en HÉROS à gauche — grande pastille. */}
        <div className="shrink-0 flex w-[84px] flex-col items-center justify-center gap-1 rounded-xl bg-rose-500/12 px-2 py-3 text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300">
          {(p.kind === "X_PLUS_Y" || p.kind === "FREE") && <Gift className="h-4 w-4" />}
          {p.kind === "PRICE" && <Tag className="h-4 w-4" />}
          <span className="text-title3 font-bold leading-none tnum text-center">{promoBadge(p)}</span>
        </div>

        {/* Corps — article, tags, métadonnées. */}
        <div className="min-w-0 flex-1">
          <p className="text-callout font-semibold text-foreground truncate leading-tight">
            {p.label?.trim() || dz.fruit}
          </p>
          <DesignationChips marque={dz.marque} calibre={dz.calibre} condt={dz.condt} variete={dz.variete} pays={dz.pays} className="mt-1" />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption2 text-muted-foreground">
            <span className="font-mono">{p.itemCode}</span>
            <span className="text-muted-foreground/40" aria-hidden>•</span>
            {(debut || fin) ? (
              <span>{debut ?? "…"} → {fin ?? "…"}</span>
            ) : (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">permanent</span>
            )}
            {storeChip && (
              <span
                title={`S'applique aux magasins : ${storeTypeLabel(p.storeType)}`}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${storeChip}`}
              >
                <Store className="h-2.5 w-2.5" />
                {storeTypeLabel(p.storeType)}
              </span>
            )}
            {proche && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded font-semibold bg-warning/12 text-warning ring-1 ring-inset ring-warning/25">
                {restants === 0 ? "se termine aujourd'hui" : `se termine dans ${restants} j`}
              </span>
            )}
          </div>
        </div>

        {/* Actions — vrai interrupteur libellé + suppression. */}
        <div className="shrink-0 flex items-center gap-2">
          <SegmentedControl
            size="sm"
            aria-label={`Statut de la promo ${p.itemCode}`}
            value={active ? "actif" : "inactif"}
            onChange={(v) => { const next = v === "actif"; if (next !== active) setActive(p, next); }}
            options={[
              { value: "actif", label: "Actif" },
              { value: "inactif", label: "Inactif" },
            ]}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleteTarget(p)}
            title="Supprimer la promo"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="kicker inline-flex items-center gap-1.5">
          <BadgePercent className="h-3 w-3" /> Promo en cours
          {!loading && <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">({promos.length})</span>}
        </p>
        <div className="flex items-center gap-1.5">
          {/* Rafraîchir — icône ghost discrète. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={load}
            disabled={loading}
            title="Recharger la liste"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Nouvelle promo
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-body text-muted-foreground inline-flex items-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </p>
      ) : promos.length === 0 ? (
        <EmptyState
          icon={BadgePercent}
          title="Aucune promo"
          description="Créez la première — elle apparaîtra en badge sur la liste stock de l'Écran 2."
          action={<Button variant="tinted" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouvelle promo</Button>}
        />
      ) : (
        <div className="space-y-6">
          <section>
            <p className="kicker mb-2">Actives <span className="font-normal normal-case tracking-normal text-muted-foreground/60">({actives.length})</span></p>
            {actives.length === 0 ? (
              <p className="text-caption text-muted-foreground italic py-2">Aucune promo active.</p>
            ) : (
              <ul className="space-y-2">{actives.map(renderCard)}</ul>
            )}
          </section>

          {inactives.length > 0 && (
            <section>
              <p className="kicker mb-2">Inactives <span className="font-normal normal-case tracking-normal text-muted-foreground/60">({inactives.length})</span></p>
              <ul className="space-y-2">{inactives.map(renderCard)}</ul>
            </section>
          )}
        </div>
      )}

      <CreatePromoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => { setCreateOpen(false); load(); }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Supprimer la promo ?"
        description={deleteTarget ? `« ${deleteTarget.label?.trim() || deleteTarget.itemCode} » sera définitivement retirée. Cette action est irréversible.` : undefined}
        confirmLabel="Supprimer"
        tone="destructive"
        onConfirm={confirmRemove}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Dialog de création — article via autocomplétion /api/products
───────────────────────────────────────────────────────────── */

function CreatePromoDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [kind, setKind] = useState<PromoKind>("PERCENT");
  const [value, setValue] = useState<number | null>(10);
  const [price, setPrice] = useState<number | null>(null);   // PRICE : prix unitaire imposé
  const [buyQty, setBuyQty] = useState<number | null>(5);
  const [freeQty, setFreeQty] = useState<number | null>(1);
  const [label, setLabel] = useState("");
  // Libellé « touché » à la main → on cesse de le recomposer automatiquement.
  const [labelTouched, setLabelTouched] = useState(false);
  // Type de magasin ciblé ("" = tous). EXPORT | GMS | CHR.
  const [storeType, setStoreType] = useState("");
  // Promo permanente (sans dates) par défaut — décocher pour fixer une période.
  const [permanent, setPermanent] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Autocomplétion article
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ProductHit | null>(null);

  // Reset complet à l'ouverture
  useEffect(() => {
    if (!open) return;
    setKind("PERCENT"); setValue(10); setPrice(null); setBuyQty(5); setFreeQty(1);
    setLabel(""); setLabelTouched(false); setStoreType("");
    setPermanent(true); setStartsAt(""); setEndsAt("");
    setQuery(""); setHits([]); setPicked(null);
  }, [open]);

  // Recherche produits (debounce 250 ms) — on capture aussi les tags produit
  // (conditionnement / pays / marque / variété) pour composer le libellé riche.
  useEffect(() => {
    const q = query.trim();
    if (picked || q.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=15`);
        const json = await res.json().catch(() => ({}));
        type ApiProduct = {
          itemCode: string; itemName: string; groupName?: string | null;
          uMarque?: string | null; uPays?: string | null;
          uCondi?: string | null; uUvc?: string | null; uCalibre?: string | null; frgnName?: string | null;
        };
        setHits(((json?.products ?? []) as ApiProduct[]).map((p) => ({
          itemCode: p.itemCode, itemName: p.itemName, groupName: p.groupName ?? null,
          marque: p.uMarque ?? null, pays: p.uPays ?? null,
          condi: p.uCondi ?? p.uUvc ?? null, variete: p.frgnName ?? null, calibre: p.uCalibre ?? null,
        })));
      } catch { setHits([]); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [query, picked]);

  // Libellé auto : pour un TARIF, on compose le libellé riche à tags
  // (« Nom  conditionnement  pays  marque   Prix Unitaire  X.XX EUR ») ; pour les
  // autres types, le nom d'article. Recomposé tant que l'admin n'a pas édité.
  useEffect(() => {
    if (labelTouched || !picked) return;
    setLabel(
      kind === "PRICE"
        ? composePriceLabel({ ...picked, value: price })
        : picked.itemName,
    );
  }, [kind, price, picked, labelTouched]);

  const pick = (h: ProductHit) => {
    setPicked(h);
    setQuery(`${h.itemName} (${h.itemCode})`);
    setHits([]);
  };

  const valid = picked != null && (
    kind === "PERCENT"
      ? value != null && value > 0 && value < 100
      : kind === "PRICE"
        ? price != null && price > 0
        : kind === "X_PLUS_Y"
          ? buyQty != null && buyQty >= 1 && freeQty != null && freeQty >= 1
          : /* FREE */ freeQty != null && freeQty >= 1
  );

  const submit = async () => {
    if (!valid || !picked) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/promos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode: picked.itemCode,
          kind,
          // PERCENT → %, PRICE → prix unitaire fixe (tous deux portés par `value`).
          value: kind === "PERCENT" ? value : kind === "PRICE" ? price : 0,
          buyQty: kind === "X_PLUS_Y" ? buyQty : 0,
          freeQty: (kind === "X_PLUS_Y" || kind === "FREE") ? freeQty : 0,
          label: label.trim() || null,
          // Cible : type de magasin ("" = tous → non envoyé).
          ...(storeType ? { storeType } : {}),
          // Promo permanente → aucune date envoyée (sinon période fixée).
          ...(!permanent && startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
          ...(!permanent && endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Création refusée");
      }
      toast.success("Promo créée — visible sur l'Écran 2");
      onCreated();
    } catch (e) {
      toast.error(`Échec création${e instanceof Error && e.message ? ` — ${e.message}` : ""}`);
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgePercent className="h-4 w-4 text-rose-500" /> Nouvelle promo
          </DialogTitle>
          <DialogDescription className="text-caption">
            Badge sur la liste stock, remise préremplie au panier, mention sur le bon SAP.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Article — autocomplétion */}
          <div className="relative">
            <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Article
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
                placeholder="Nom ou code article (min. 2 caractères)…"
                className="w-full h-10 pl-9 pr-2 rounded-md border border-border bg-background text-callout focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {hits.length > 0 && (
              <ul className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-modal">
                {hits.map((h) => (
                  <li key={h.itemCode}>
                    <button type="button" onClick={() => pick(h)}
                      className="w-full px-3 py-2 text-left hover:bg-secondary/50">
                      <span className="block text-body font-medium text-foreground truncate">{h.itemName}</span>
                      <span className="block text-caption2 font-mono text-muted-foreground/70">
                        {h.itemCode}{h.groupName ? ` · ${h.groupName}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Type de promo
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" aria-pressed={kind === "PERCENT"} onClick={() => setKind("PERCENT")}
                className={`h-10 rounded-md border text-caption font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  kind === "PERCENT" ? "border-rose-400/70 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <BadgePercent className="h-4 w-4" /> Remise %
              </button>
              <button type="button" aria-pressed={kind === "PRICE"} onClick={() => setKind("PRICE")}
                className={`h-10 rounded-md border text-caption font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  kind === "PRICE" ? "border-rose-400/70 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <Tag className="h-4 w-4" /> Tarif imposé
              </button>
              <button type="button" aria-pressed={kind === "X_PLUS_Y"} onClick={() => setKind("X_PLUS_Y")}
                className={`h-10 rounded-md border text-caption font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  kind === "X_PLUS_Y" ? "border-rose-400/70 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <Gift className="h-4 w-4" /> X + Y
              </button>
              <button type="button" aria-pressed={kind === "FREE"} onClick={() => setKind("FREE")}
                className={`h-10 rounded-md border text-caption font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  kind === "FREE" ? "border-rose-400/70 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <PackagePlus className="h-4 w-4" /> Colis offert
              </button>
            </div>
          </div>

          {/* Valeur selon le type */}
          {kind === "PERCENT" ? (
            <div>
              <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                Remise (%)
              </label>
              <div className="flex items-center gap-2">
                <NumberInput value={value} onValueChange={setValue} min={0} max={99} step={1}
                  aria-label="Remise en pourcentage"
                  className="h-10 w-24 text-right text-callout tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                <span className="text-callout text-muted-foreground">% sur le prix conseillé</span>
              </div>
            </div>
          ) : kind === "PRICE" ? (
            <div>
              <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                Prix unitaire imposé
              </label>
              <div className="flex items-center gap-2">
                <NumberInput value={price} onValueChange={setPrice} min={0} step={0.01}
                  aria-label="Prix unitaire imposé (€)"
                  className="h-10 w-28 text-right text-callout tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                <span className="text-callout text-muted-foreground">€ / unité — remplace le prix conseillé</span>
              </div>
            </div>
          ) : kind === "FREE" ? (
            <div>
              <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                Colis offerts
              </label>
              <div className="flex items-center gap-2">
                <NumberInput value={freeQty} onValueChange={setFreeQty} min={1} step={1}
                  aria-label="Colis offerts"
                  className="h-10 w-20 text-right text-callout tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                <span className="text-body text-muted-foreground">colis offert(s) — sans condition d&apos;achat, ligne à 0 € sur le bon</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                  Colis achetés
                </label>
                <NumberInput value={buyQty} onValueChange={setBuyQty} min={1} step={1}
                  aria-label="Colis achetés"
                  className="h-10 w-20 text-right text-callout tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <span className="text-callout font-bold text-muted-foreground pb-2">+</span>
              <div>
                <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                  Colis offerts
                </label>
                <NumberInput value={freeQty} onValueChange={setFreeQty} min={1} step={1}
                  aria-label="Colis offerts"
                  className="h-10 w-20 text-right text-callout tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <p className="text-caption2 text-muted-foreground pb-2">
                ex. 5+1 : le 6ᵉ colis est offert
              </p>
            </div>
          )}

          {/* Type de magasin ciblé — applique la promo à TOUS les magasins de ce type */}
          <div>
            <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              <span className="inline-flex items-center gap-1"><Store className="h-3 w-3" /> Magasins concernés</span>
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {STORE_OPTIONS.map((o) => (
                <button key={o.value || "all"} type="button" aria-pressed={storeType === o.value}
                  onClick={() => setStoreType(o.value)}
                  className={`h-9 rounded-md border text-caption font-semibold transition-colors ${
                    storeType === o.value ? "border-brand-400/70 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300" : "border-border text-muted-foreground hover:text-foreground"
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-caption2 text-muted-foreground mt-1">
              {storeType
                ? `S'applique à tous les magasins de type ${storeTypeLabel(storeType)}.`
                : "S'applique à tous les magasins, quel que soit leur type."}
            </p>
          </div>

          {/* Libellé */}
          <div>
            <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Libellé (mention sur le bon)
            </label>
            <input value={label}
              onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
              placeholder="ex. Groseille Mixte  12x125g  Belgique  Belorta   Prix Unitaire  2.80 EUR"
              className="w-full h-10 rounded-md border border-border bg-background text-callout px-2.5 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            {kind === "PRICE" && !labelTouched && picked && (
              <p className="text-caption2 text-muted-foreground mt-1">
                Libellé composé automatiquement depuis les tags de l&apos;article — modifiable.
              </p>
            )}
          </div>

          {/* Durée : permanente (sans dates) ou période fixée */}
          <div>
            <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Durée
            </label>
            <label className="inline-flex items-center gap-2 text-body text-foreground cursor-pointer select-none">
              <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)}
                className="h-4 w-4 accent-rose-500" />
              Promo permanente <span className="text-muted-foreground">(sans date de fin)</span>
            </label>
            {!permanent && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                    Début (optionnel)
                  </label>
                  <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background text-body px-2" />
                </div>
                <div>
                  <label className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                    Fin (optionnel)
                  </label>
                  <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background text-body px-2" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Créer la promo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
