"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ShelfItem = { itemCode: string; itemName: string | null; days: number };
type Hit = { itemCode: string; itemName: string };

/**
 * Réglage des durées de vie par défaut (en JOURS) par article. À la réception,
 * la DLC se pré-remplit à « date de réception + jours » (modifiable par ligne).
 */
export function ShelfLifePanel() {
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/products/shelf-life", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setItems(j.items ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Recherche d'article (debounce léger).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancel = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/products?search=${encodeURIComponent(term)}&limit=8`, { cache: "no-store" });
        if (!cancel && r.ok) {
          const j = await r.json();
          setHits(
            (j.products ?? []).map((p: { itemCode: string; itemName: string }) => ({
              itemCode: p.itemCode,
              itemName: p.itemName,
            })),
          );
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancel) setSearching(false);
      }
    }, 250);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [q]);

  const save = useCallback(async (itemCode: string, itemName: string | null, days: number) => {
    try {
      const r = await fetch("/api/products/shelf-life", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode, days }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Échec de l'enregistrement");
      }
      if (days <= 0) {
        setItems((c) => c.filter((it) => it.itemCode !== itemCode));
        toast.success(`Durée de vie retirée — ${itemCode}`);
      } else {
        setItems((c) => {
          const exists = c.some((it) => it.itemCode === itemCode);
          if (exists) return c.map((it) => (it.itemCode === itemCode ? { ...it, days } : it));
          return [{ itemCode, itemName, days }, ...c];
        });
        toast.success(`${days} j — ${itemName ?? itemCode}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  const addFromHit = (h: Hit) => {
    setQ("");
    setHits([]);
    if (items.some((it) => it.itemCode === h.itemCode)) {
      toast.info("Article déjà configuré — ajuste les jours dans la liste.");
      return;
    }
    save(h.itemCode, h.itemName, 3); // défaut 3 jours (fraise) — modifiable aussitôt
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Durée de vie par défaut (en <b>jours</b>) par article. À la réception, la DLC se pré-remplit
        automatiquement à <b>date de réception + jours</b> (modifiable ligne par ligne).
      </p>

      {/* Recherche d'article à configurer */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un article (nom ou code)…"
          className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-background text-[13px] focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
        />
        {(hits.length > 0 || searching) && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-modal max-h-64 overflow-auto">
            {searching && (
              <div className="px-3 py-2 text-[12px] text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Recherche…
              </div>
            )}
            {hits.map((h) => (
              <button
                key={h.itemCode}
                type="button"
                onClick={() => addFromHit(h)}
                className="w-full text-left px-3 py-2 hover:bg-secondary/60 flex items-center justify-between gap-2 transition-colors"
              >
                <span className="text-[13px] truncate">{h.itemName}</span>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0 flex items-center gap-1">
                  <Plus className="h-3 w-3" />
                  {h.itemCode}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Liste configurée */}
      {loading ? (
        <p className="text-[12px] text-muted-foreground">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] italic text-muted-foreground">
          Aucune durée de vie configurée. Recherche un article ci-dessus pour en ajouter une.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={it.itemCode}
              className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] truncate">{it.itemName ?? it.itemCode}</div>
                <div className="text-[11px] font-mono text-muted-foreground">{it.itemCode}</div>
              </div>
              <DaysInput value={it.days} onCommit={(d) => save(it.itemCode, it.itemName, d)} />
              <button
                type="button"
                title="Retirer la durée de vie"
                onClick={() => save(it.itemCode, it.itemName, 0)}
                className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DaysInput({ value, onCommit }: { value: number; onCommit: (d: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => {
    setV(String(value));
  }, [value]);
  const commit = () => {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    else setV(String(value));
  };
  return (
    <div className="flex items-center gap-1 shrink-0">
      <input
        type="number"
        min={1}
        max={365}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-8 w-16 rounded-lg border border-border bg-background text-[13px] text-center tnum focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
        aria-label="Nombre de jours"
      />
      <span className="text-[11px] text-muted-foreground">j</span>
    </div>
  );
}
