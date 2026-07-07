"use client";

/**
 * TARIF PAR FRUITS — éditeur (fiche client ET console, onglet Tarif).
 *
 * Prix négociés au niveau DÉSIGNATION : Famille (obligatoire) + Origine + Calibre
 * + Variété (optionnels). Le prix descend automatiquement sur l'article à la
 * création si sa désignation matche la ligne la plus précise. Sauvegarde auto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Loader2, Check, Grape } from "lucide-react";
import { toast } from "sonner";
import { FRUIT_FAMILIES } from "@/lib/familles";
import type { TarifFruitRow } from "@/lib/tarifFruits";

const FAMILY_LABEL = new Map(FRUIT_FAMILIES.map((f) => [f.key, f.label]));
const familyLabel = (key: string) => FAMILY_LABEL.get(key) ?? key;

export function TarifFruitsEditor({ clientId, compact = false }: { clientId: string; compact?: boolean }) {
  const [rows, setRows] = useState<TarifFruitRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const dirty = useRef(false);

  // Ligne en cours d'ajout.
  const [nf, setNf] = useState(FRUIT_FAMILIES[0].key);
  const [np, setNp] = useState("");
  const [nc, setNc] = useState("");
  const [nv, setNv] = useState("");
  const [nprice, setNprice] = useState("");

  useEffect(() => {
    let cancelled = false;
    dirty.current = false;
    setRows(null);
    fetch(`/api/clients/${clientId}/tarif-fruits`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setRows(j?.ok ? (j.rows ?? []) : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [clientId]);

  // Sauvegarde auto (débounce 700 ms) quand modifié.
  useEffect(() => {
    if (!dirty.current || rows === null) return;
    const t = setTimeout(() => {
      dirty.current = false;
      setSaving(true);
      fetch(`/api/clients/${clientId}/tarif-fruits`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      })
        .then((r) => r.json())
        .then((j) => { if (j?.ok) { setSavedAt(true); setTimeout(() => setSavedAt(false), 1500); } else toast.error(j?.error || "Échec de l'enregistrement du tarif"); })
        .catch(() => toast.error("Échec de l'enregistrement du tarif"))
        .finally(() => setSaving(false));
    }, 700);
    return () => clearTimeout(t);
  }, [rows, clientId]);

  const mutate = useCallback((fn: (cur: TarifFruitRow[]) => TarifFruitRow[]) => {
    dirty.current = true;
    setRows((cur) => fn(cur ?? []));
  }, []);

  const addRow = () => {
    const price = Number(nprice.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) { toast.error("Prix invalide"); return; }
    mutate((cur) => [...cur, {
      family: nf,
      pays: np.trim() || null,
      calibre: nc.trim() || null,
      variete: nv.trim() || null,
      price: Math.round(price * 10000) / 10000,
    }]);
    setNp(""); setNc(""); setNv(""); setNprice("");
  };

  const setPrice = (idx: number, v: string) => {
    const price = Number(v.replace(",", "."));
    mutate((cur) => cur.map((r, i) => i === idx ? { ...r, price: Number.isFinite(price) ? price : 0 } : r));
  };
  const removeRow = (idx: number) => mutate((cur) => cur.filter((_, i) => i !== idx));

  const sorted = useMemo(
    () => (rows ?? []).map((r, i) => ({ r, i }))
      .sort((a, b) => familyLabel(a.r.family).localeCompare(familyLabel(b.r.family))
        || (a.r.pays ?? "").localeCompare(b.r.pays ?? "")
        || (a.r.calibre ?? "").localeCompare(b.r.calibre ?? "")),
    [rows],
  );

  const inputCls = "h-9 rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500/40";

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Grape className="h-4 w-4 text-brand-500 shrink-0" />
          <p>
            Prix par <b>fruit</b> (famille) affinés par <b>origine</b>, <b>calibre</b> et <b>variété</b> (optionnels).
            À la commande, l&apos;article prend le prix de la ligne la plus précise qui lui correspond.
          </p>
          <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px]">
            {saving ? <><Loader2 className="h-3 w-3 animate-spin" /> Enregistrement…</>
              : savedAt ? <><Check className="h-3 w-3 text-emerald-500" /> Enregistré</> : null}
          </span>
        </div>
      )}

      {/* Lignes existantes */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1.2fr_1fr_0.8fr_1fr_100px_36px] gap-2 px-3 py-2 bg-secondary/30 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Fruit</span><span>Origine</span><span>Calibre</span><span>Variété</span><span className="text-right">Prix HT</span><span />
        </div>
        {rows === null ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : sorted.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">Aucun tarif fruit. Ajoute une ligne ci-dessous.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {sorted.map(({ r, i }) => (
              <li key={i} className="grid grid-cols-2 sm:grid-cols-[1.2fr_1fr_0.8fr_1fr_100px_36px] gap-2 px-3 py-2 items-center">
                <span className="text-[13.5px] font-semibold text-foreground">{familyLabel(r.family)}</span>
                <span className="text-[13px] text-muted-foreground truncate">{r.pays || <span className="opacity-40">toutes</span>}</span>
                <span className="text-[13px] text-muted-foreground truncate">{r.calibre || <span className="opacity-40">tous</span>}</span>
                <span className="text-[13px] text-muted-foreground truncate">{r.variete || <span className="opacity-40">toutes</span>}</span>
                <div className="flex items-center gap-1 justify-end">
                  <input
                    type="text" inputMode="decimal" defaultValue={String(r.price)}
                    onBlur={(e) => setPrice(i, e.target.value)}
                    aria-label={`Prix ${familyLabel(r.family)}`}
                    className="h-8 w-[76px] rounded-md border border-border bg-card px-2 text-right text-[13px] font-semibold tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  />
                  <span className="text-[11px] text-muted-foreground">€</span>
                </div>
                <button
                  type="button" onClick={() => removeRow(i)} aria-label="Supprimer la ligne"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors justify-self-end"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Ajout d'une ligne */}
      <div className="grid grid-cols-2 sm:grid-cols-[1.2fr_1fr_0.8fr_1fr_100px_auto] gap-2 items-center">
        <select value={nf} onChange={(e) => setNf(e.target.value)} aria-label="Fruit" className={inputCls}>
          {FRUIT_FAMILIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <input value={np} onChange={(e) => setNp(e.target.value)} placeholder="Origine" aria-label="Origine" className={inputCls} />
        <input value={nc} onChange={(e) => setNc(e.target.value)} placeholder="Calibre" aria-label="Calibre" className={inputCls} />
        <input value={nv} onChange={(e) => setNv(e.target.value)} placeholder="Variété" aria-label="Variété" className={inputCls} />
        <input value={nprice} onChange={(e) => setNprice(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addRow(); }}
          type="text" inputMode="decimal" placeholder="Prix €" aria-label="Prix" className={`${inputCls} text-right tnum`} />
        <button
          type="button" onClick={addRow}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-3 text-[12.5px] font-semibold active:scale-95 transition-all"
        >
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>
    </div>
  );
}
