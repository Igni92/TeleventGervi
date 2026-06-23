"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, ClipboardCheck, Send, CheckCircle2, AlertTriangle } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { designationProduit } from "@/lib/produit-designation";
import type { InventorySession } from "@/lib/inventory";

type Product = {
  id: string; itemCode: string; itemName: string;
  salesQtyPerPackUnit: number | null; salesUnit: string | null;
  uPays: string | null; uMarque: string | null; uCondi: string | null;
  stockByWarehouse: Record<string, { available: number }>;
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtDate = (s: string) => new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** SAP en COLIS (available ÷ pièces par colis), unité affichée. */
function sapInfo(p: Product): { qty: number; unit: string } {
  const avail = ["000", "01", "R1"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0);
  const isKg = /kg|kilo/i.test(p.salesUnit ?? "");
  const ratio = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
  return { qty: Math.round((avail / ratio) * 10) / 10, unit: isKg ? "kg" : "colis" };
}

export function InventairePanel({ isAdmin }: { isAdmin: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessions, setSessions] = useState<InventorySession[]>([]);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.itemCode} ${p.itemName} ${p.uMarque ?? ""} ${p.uPays ?? ""}`.toLowerCase().includes(q));
  }, [products, query]);

  const countedCount = Object.values(counts).filter((v) => v != null && Number.isFinite(v)).length;

  async function submit() {
    const lines = products
      .filter((p) => counts[p.itemCode] != null && Number.isFinite(counts[p.itemCode] as number))
      .map((p) => {
        const s = sapInfo(p);
        return { itemCode: p.itemCode, itemName: p.itemName, sapQty: s.qty, realQty: counts[p.itemCode] as number, unit: s.unit };
      });
    if (lines.length === 0) { toast.error("Saisis au moins un comptage."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventaire", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, lines }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error(json.error ?? "Erreur"); return; }
      toast.success(`Inventaire envoyé — ${json.session.nbEcarts} écart(s) signalé(s) aux administrateurs.`, { duration: 8000 });
      setCounts({}); setNote("");
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

  return (
    <div className="space-y-6">
      {/* Saisie du comptage */}
      <SurfaceCard accent="sky" className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" /> Comptage du stock
          </h2>
          <span className="text-[12px] text-muted-foreground">{countedCount} article(s) compté(s)</span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer un article…" className="pl-9" />
        </div>

        {loading ? (
          <div className="h-32 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y divide-border/60 max-h-[60vh] overflow-y-auto rounded-lg border border-border">
            {filtered.map((p) => {
              const s = sapInfo(p);
              const dz = designationProduit({ itemName: p.itemName, uPays: p.uPays, uMarque: p.uMarque, uCondi: p.uCondi });
              const real = counts[p.itemCode];
              const ecart = real != null && Number.isFinite(real) ? Math.round((real - s.qty) * 10) / 10 : null;
              return (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-foreground truncate">{dz.fruit}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{p.itemCode}</div>
                  </div>
                  <div className="text-right shrink-0 w-20">
                    <div className="text-[15px] font-bold tnum text-foreground">{fmt(s.qty)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">SAP {s.unit}</div>
                  </div>
                  <div className="shrink-0 w-24">
                    <NumberInput
                      value={real ?? null}
                      onValueChange={(n) => setCounts((c) => ({ ...c, [p.itemCode]: n }))}
                      min={0} step={1} allowEmpty placeholder="réel"
                      className="h-11 w-full text-center text-[16px] font-semibold"
                    />
                  </div>
                  <div className="shrink-0 w-14 text-right">
                    {ecart != null && (
                      <span className={`text-[13px] font-bold tnum ${ecart === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {ecart > 0 ? `+${fmt(ecart)}` : fmt(ecart)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (zone, remarque…) — optionnel" />
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button onClick={submit} disabled={submitting || countedCount === 0}>
            {submitting ? <Loader2 className="animate-spin" /> : <Send />}
            Envoyer l&apos;inventaire ({countedCount})
          </Button>
        </div>
      </SurfaceCard>

      {/* Historique / états (écarts) */}
      <SurfaceCard accent="amber" className="p-5 space-y-3">
        <h2 className="text-[15px] font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" /> États d&apos;inventaire {isAdmin ? "" : "(les miens)"}
        </h2>
        {sessions.length === 0 && <p className="text-[12px] italic text-muted-foreground py-2">Aucun inventaire pour l&apos;instant.</p>}
        <div className="space-y-2">
          {sessions.map((s) => {
            const ecarts = s.lines.filter((l) => Math.abs(l.ecart) > 0.001);
            return (
              <div key={s.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground">{fmtDate(s.createdAt)} · {s.createdBy}</div>
                    <div className="text-[12px] text-muted-foreground">{s.lines.length} article(s) · {s.nbEcarts} écart(s){s.note ? ` · « ${s.note} »` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.status === "reviewed" ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> revu</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12px] text-amber-600 dark:text-amber-400 font-semibold">à revoir</span>
                    )}
                    {isAdmin && s.status === "submitted" && (
                      <Button size="sm" variant="outline" onClick={() => review(s.id)}>Marquer revu</Button>
                    )}
                  </div>
                </div>
                {ecarts.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/60 flex flex-wrap gap-1.5">
                    {ecarts.map((l) => (
                      <span key={l.itemCode} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        <span className="font-mono">{l.itemCode}</span>
                        <span className="text-muted-foreground">SAP {fmt(l.sapQty)} → réel {fmt(l.realQty)}</span>
                        <b className="tnum">{l.ecart > 0 ? `+${fmt(l.ecart)}` : fmt(l.ecart)} {l.unit}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SurfaceCard>
    </div>
  );
}
