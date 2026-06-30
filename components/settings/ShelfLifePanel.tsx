"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ShelfItem = { itemCode: string; itemName: string | null; days: number };
type GroupRow = { key: string; label: string; days: number | null };
type Hit = { itemCode: string; itemName: string };

/**
 * Réglage des durées de vie par défaut (en JOURS) :
 *   - PAR GROUPE de fruits (Fraises / Framboises / … / Autres) — la base ;
 *   - PAR ARTICLE (exceptions) — déroge au groupe pour un article précis.
 * À la réception, la DLC se pré-remplit à « date du jour + jours » (article si
 * défini, sinon groupe), modifiable ligne par ligne.
 */
export function ShelfLifePanel() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
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
        setGroups(j.groups ?? []);
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

  const saveGroup = useCallback(async (key: string, days: number) => {
    try {
      const r = await fetch("/api/products/shelf-life", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupKey: key, days }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Échec de l'enregistrement");
      }
      setGroups((c) => c.map((g) => (g.key === key ? { ...g, days: days > 0 ? days : null } : g)));
      toast.success(days > 0 ? `${days} j — groupe mis à jour` : "Défaut du groupe retiré");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  const saveItem = useCallback(async (itemCode: string, itemName: string | null, days: number) => {
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
        toast.success(`Exception retirée — ${itemCode}`);
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
      toast.info("Article déjà dans les exceptions — ajuste les jours dans la liste.");
      return;
    }
    saveItem(h.itemCode, h.itemName, 3); // défaut 3 j — modifiable aussitôt
  };

  return (
    <div className="space-y-5">
      {/* ── Par GROUPE de fruits ── */}
      <div className="space-y-2">
        <p className="text-[12px] text-muted-foreground">
          Durée de vie par défaut (en <b>jours</b>) par groupe. À la réception, la DLC se pré-remplit à{" "}
          <b>date du jour + jours du groupe</b> (modifiable par ligne). Laisse vide pour ne rien pré-remplir.
        </p>
        {loading ? (
          <p className="text-[12px] text-muted-foreground">Chargement…</p>
        ) : (
          <ul className="space-y-1.5">
            {groups.map((g) => (
              <li
                key={g.key}
                className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2"
              >
                <span className="flex-1 text-[13px] font-medium">{g.label}</span>
                <DaysInput value={g.days} allowEmpty onCommit={(d) => saveGroup(g.key, d)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Exceptions par article ── */}
      <div className="space-y-3">
        <div className="hairline" />
        <div>
          <p className="text-[13px] font-semibold text-foreground">Exceptions par article</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Pour un article précis qui doit déroger à la durée de vie de son groupe.
          </p>
        </div>

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

        {items.length === 0 ? (
          <p className="text-[12px] italic text-muted-foreground">Aucune exception. Le groupe s&apos;applique à tous les articles.</p>
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
                <DaysInput value={it.days} onCommit={(d) => saveItem(it.itemCode, it.itemName, d)} />
                <button
                  type="button"
                  title="Retirer l'exception"
                  onClick={() => saveItem(it.itemCode, it.itemName, 0)}
                  className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DaysInput({
  value,
  onCommit,
  allowEmpty = false,
}: {
  value: number | null;
  onCommit: (d: number) => void;
  allowEmpty?: boolean;
}) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setV(value == null ? "" : String(value));
  }, [value]);
  const commit = () => {
    const raw = v.trim();
    if (raw === "") {
      if (allowEmpty && value != null) onCommit(0);
      else setV(value == null ? "" : String(value));
      return;
    }
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    else setV(value == null ? "" : String(value));
  };
  return (
    <div className="flex items-center gap-1 shrink-0">
      <input
        type="number"
        min={1}
        max={365}
        value={v}
        placeholder={allowEmpty ? "—" : undefined}
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
