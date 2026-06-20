"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BadgePercent, Gift, Loader2, PackagePlus, Plus, Power, RefreshCw, Search, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

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

interface Promo {
  id: string;
  itemCode: string;
  kind: "PERCENT" | "X_PLUS_Y" | "FREE";
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  label: string | null;
  /** argumentaire commercial court — affiché dans le bandeau PromoBanner */
  pitch?: string | null;
  // Champs optionnels (selon implémentation serveur) — tolérés, jamais requis
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  itemName?: string | null;
}

interface ProductHit { itemCode: string; itemName: string; groupName: string | null }

/** Libellé court du type : « −10 % », « 5+1 » ou « +1 offert ». */
function promoBadge(p: Promo): string {
  if (p.kind === "PERCENT") return `−${String(Math.round((p.value ?? 0) * 100) / 100)} %`;
  if (p.kind === "FREE") { const n = p.freeQty ?? 1; return `+${n} offert${n > 1 ? "s" : ""}`; }
  return `${p.buyQty ?? "?"}+${p.freeQty ?? "?"}`;
}

function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR");
}

export function PromosManager() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  // Suppression en 2 temps (pas de window.confirm) : 1er clic arme, 2e confirme.
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);

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

  // Désarme la suppression après 3 s sans confirmation
  useEffect(() => {
    if (!armedDeleteId) return;
    const t = setTimeout(() => setArmedDeleteId(null), 3000);
    return () => clearTimeout(t);
  }, [armedDeleteId]);

  const toggleActive = async (p: Promo) => {
    const next = !(p.active ?? true);
    try {
      const res = await fetch(`/api/promos/${p.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? "Promo réactivée" : "Promo désactivée");
      load();
    } catch { toast.error("Échec de la mise à jour"); }
  };

  const remove = async (p: Promo) => {
    if (armedDeleteId !== p.id) { setArmedDeleteId(p.id); return; }
    setArmedDeleteId(null);
    try {
      const res = await fetch(`/api/promos/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Promo supprimée");
      setPromos((cur) => cur.filter((x) => x.id !== p.id));
    } catch { toast.error("Échec de la suppression"); }
  };

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="kicker inline-flex items-center gap-1.5">
          <BadgePercent className="h-3 w-3" /> Promos en cours
          {!loading && <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">({promos.length})</span>}
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={load} disabled={loading}
            title="Recharger la liste"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Nouvelle promo
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] text-muted-foreground inline-flex items-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </p>
      ) : promos.length === 0 ? (
        <p className="text-[14px] text-muted-foreground italic py-6 text-center">
          Aucune promo. Crée la première — elle apparaîtra en badge sur la liste stock de l&apos;Écran 2.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {promos.map((p) => {
            const active = p.active ?? true;
            const debut = fmtDate(p.startsAt);
            const fin = fmtDate(p.endsAt);
            return (
              <li key={p.id} className={`flex items-center gap-3 py-2.5 ${active ? "" : "opacity-55"}`}>
                {/* Type — chip vif assorti au badge de l'Écran 2 */}
                <span className="inline-flex h-[24px] min-w-[64px] justify-center items-center px-2 rounded-[5px] text-[13px] font-bold shrink-0 bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/70 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/60">
                  {(p.kind === "X_PLUS_Y" || p.kind === "FREE") && <Gift className="h-3 w-3 mr-1" />}
                  {promoBadge(p)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold text-foreground truncate leading-tight">
                    {p.label?.trim() || p.itemName || p.itemCode}
                  </p>
                  <p className="text-[11px] font-mono text-muted-foreground/70 truncate mt-0.5">
                    {p.itemCode}
                    {(debut || fin) ? (
                      <span className="font-sans text-muted-foreground/80">
                        {" "}· {debut ?? "…"} → {fin ?? "…"}
                      </span>
                    ) : (
                      <span className="font-sans text-emerald-600/80 dark:text-emerald-400/80">
                        {" "}· permanente
                      </span>
                    )}
                  </p>
                </div>
                {!active && (
                  <span className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground shrink-0">
                    Inactive
                  </span>
                )}
                <button type="button" onClick={() => toggleActive(p)}
                  title={active ? "Désactiver (disparaît de l'Écran 2)" : "Réactiver"}
                  className={`h-8 w-8 inline-flex items-center justify-center rounded-md border transition-colors shrink-0 ${
                    active
                      ? "border-emerald-400/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}>
                  <Power className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => remove(p)}
                  title={armedDeleteId === p.id ? "Clique à nouveau pour confirmer" : "Supprimer"}
                  className={`h-8 inline-flex items-center gap-1 px-2 rounded-md border transition-colors shrink-0 text-[11.5px] font-semibold ${
                    armedDeleteId === p.id
                      ? "border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                      : "border-border text-muted-foreground/60 hover:text-rose-500 hover:border-rose-400/60"
                  }`}>
                  <Trash2 className="h-4 w-4" />
                  {armedDeleteId === p.id && "Confirmer ?"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <CreatePromoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => { setCreateOpen(false); load(); }}
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
  const [kind, setKind] = useState<"PERCENT" | "X_PLUS_Y" | "FREE">("PERCENT");
  const [value, setValue] = useState<number | null>(10);
  const [buyQty, setBuyQty] = useState<number | null>(5);
  const [freeQty, setFreeQty] = useState<number | null>(1);
  const [label, setLabel] = useState("");
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
    setKind("PERCENT"); setValue(10); setBuyQty(5); setFreeQty(1);
    setLabel(""); setPermanent(true); setStartsAt(""); setEndsAt("");
    setQuery(""); setHits([]); setPicked(null);
  }, [open]);

  // Recherche produits (debounce 250 ms)
  useEffect(() => {
    const q = query.trim();
    if (picked || q.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=15`);
        const json = await res.json().catch(() => ({}));
        setHits(((json?.products ?? []) as ProductHit[]).map((p) => ({
          itemCode: p.itemCode, itemName: p.itemName, groupName: p.groupName ?? null,
        })));
      } catch { setHits([]); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [query, picked]);

  const pick = (h: ProductHit) => {
    setPicked(h);
    setQuery(`${h.itemName} (${h.itemCode})`);
    setHits([]);
    // Le libellé sert à la mention « PROMO : … » sur le bon — prérempli avec le nom.
    setLabel((cur) => cur.trim() ? cur : h.itemName);
  };

  const valid = picked != null && (
    kind === "PERCENT"
      ? value != null && value > 0 && value < 100
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
          value: kind === "PERCENT" ? value : 0,
          buyQty: kind === "X_PLUS_Y" ? buyQty : 0,
          freeQty: (kind === "X_PLUS_Y" || kind === "FREE") ? freeQty : 0,
          label: label.trim() || null,
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
          <DialogDescription className="text-[12.5px]">
            Badge sur la liste stock, remise préremplie au panier, mention sur le bon SAP.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Article — autocomplétion */}
          <div className="relative">
            <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Article
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
                placeholder="Nom ou code article (min. 2 caractères)…"
                className="w-full h-10 pl-9 pr-2 rounded-md border border-border bg-background text-[14px] focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {hits.length > 0 && (
              <ul className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-modal">
                {hits.map((h) => (
                  <li key={h.itemCode}>
                    <button type="button" onClick={() => pick(h)}
                      className="w-full px-3 py-2 text-left hover:bg-secondary/50">
                      <span className="block text-[13.5px] font-medium text-foreground truncate">{h.itemName}</span>
                      <span className="block text-[10.5px] font-mono text-muted-foreground/70">
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
            <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Type de promo
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" aria-pressed={kind === "PERCENT"} onClick={() => setKind("PERCENT")}
                className={`h-10 rounded-md border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  kind === "PERCENT" ? "border-rose-400/70 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <BadgePercent className="h-4 w-4" /> Remise %
              </button>
              <button type="button" aria-pressed={kind === "X_PLUS_Y"} onClick={() => setKind("X_PLUS_Y")}
                className={`h-10 rounded-md border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  kind === "X_PLUS_Y" ? "border-rose-400/70 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <Gift className="h-4 w-4" /> X + Y
              </button>
              <button type="button" aria-pressed={kind === "FREE"} onClick={() => setKind("FREE")}
                className={`h-10 rounded-md border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  kind === "FREE" ? "border-rose-400/70 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <PackagePlus className="h-4 w-4" /> Colis offert
              </button>
            </div>
          </div>

          {/* Valeur selon le type */}
          {kind === "PERCENT" ? (
            <div>
              <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                Remise (%)
              </label>
              <div className="flex items-center gap-2">
                <NumberInput value={value} onValueChange={setValue} min={0} max={99} step={1}
                  aria-label="Remise en pourcentage"
                  className="h-10 w-24 text-right text-[15px] tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                <span className="text-[14px] text-muted-foreground">% sur le prix conseillé</span>
              </div>
            </div>
          ) : kind === "FREE" ? (
            <div>
              <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                Colis offerts
              </label>
              <div className="flex items-center gap-2">
                <NumberInput value={freeQty} onValueChange={setFreeQty} min={1} step={1}
                  aria-label="Colis offerts"
                  className="h-10 w-20 text-right text-[15px] tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                <span className="text-[13.5px] text-muted-foreground">colis offert(s) — sans condition d&apos;achat, ligne à 0 € sur le bon</span>
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                  Colis achetés
                </label>
                <NumberInput value={buyQty} onValueChange={setBuyQty} min={1} step={1}
                  aria-label="Colis achetés"
                  className="h-10 w-20 text-right text-[15px] tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <span className="text-[16px] font-bold text-muted-foreground pb-2">+</span>
              <div>
                <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                  Colis offerts
                </label>
                <NumberInput value={freeQty} onValueChange={setFreeQty} min={1} step={1}
                  aria-label="Colis offerts"
                  className="h-10 w-20 text-right text-[15px] tnum rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <p className="text-[11.5px] text-muted-foreground pb-2">
                ex. 5+1 : le 6ᵉ colis est offert
              </p>
            </div>
          )}

          {/* Libellé */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Libellé (mention sur le bon)
            </label>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="ex. Fraise Hoogstraten — promo semaine"
              className="w-full h-10 rounded-md border border-border bg-background text-[14px] px-2.5 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          {/* Durée : permanente (sans dates) ou période fixée */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
              Durée
            </label>
            <label className="inline-flex items-center gap-2 text-[13.5px] text-foreground cursor-pointer select-none">
              <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)}
                className="h-4 w-4 accent-rose-500" />
              Promo permanente <span className="text-muted-foreground">(sans date de fin)</span>
            </label>
            {!permanent && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                    Début (optionnel)
                  </label>
                  <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background text-[13px] px-2" />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground block mb-1">
                    Fin (optionnel)
                  </label>
                  <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background text-[13px] px-2" />
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
