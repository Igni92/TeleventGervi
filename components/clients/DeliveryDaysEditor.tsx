"use client";

import { useEffect, useState } from "react";
import { Save, Truck, CalendarOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { parseDeliveryDays } from "@/lib/deliveryDays";

/**
 * Jours de livraison du client (onglet Logistique).
 *
 * Cases décochables : si TOUT est décoché, le client « ne se fait pas livrer »
 * → ses bons sont datés au jour le jour (sinon au prochain jour de livraison).
 * Persisté via PATCH /api/clients/[id]/delivery-days ([] → "" = non livré).
 */
const JOURS = [
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mer", value: 3 },
  { label: "Jeu", value: 4 },
  { label: "Ven", value: 5 },
  { label: "Sam", value: 6 },
  { label: "Dim", value: 0 },
];

const sortKey = (n: number) => (n === 0 ? 7 : n);

export function DeliveryDaysEditor({ clientId }: { clientId: string }) {
  const [days, setDays] = useState<number[]>([]);
  const [initial, setInitial] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((c) => {
        if (cancelled) return;
        const dd = parseDeliveryDays(c?.joursLivraison);
        const v = dd.delivered ? dd.days.slice().sort((a, b) => sortKey(a) - sortKey(b)) : [];
        setDays(v);
        setInitial(v);
      })
      .catch(() => { if (!cancelled) { setDays([]); setInitial([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  const toggle = (val: number) =>
    setDays((cur) => (cur.includes(val) ? cur.filter((j) => j !== val) : [...cur, val].sort((a, b) => sortKey(a) - sortKey(b))));

  const dirty =
    initial != null &&
    (initial.length !== days.length || initial.some((d) => !days.includes(d)));
  const delivered = days.length > 0;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/delivery-days`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jours: days }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Erreur ${res.status}`);
      setInitial(days.slice());
      toast.success(delivered ? "Jours de livraison enregistrés" : "Client marqué « non livré »");
    } catch (e) {
      toast.error(`Échec : ${e instanceof Error ? e.message : ""}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {JOURS.map(({ label, value }) => {
          const active = days.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggle(value)}
              aria-pressed={active}
              className={`h-9 w-12 rounded-lg border text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
                active
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-[0_2px_10px_-2px_rgba(16,185,129,0.5)]"
                  : "border-border bg-card text-muted-foreground hover:border-emerald-400 hover:text-emerald-600 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* État : livré vs non livré + impact sur la date des bons */}
      {delivered ? (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Truck className="h-3.5 w-3.5 text-emerald-500" />
          Les bons sont datés au <span className="font-medium text-foreground">prochain jour de livraison</span>.
        </p>
      ) : (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 px-2.5 py-1.5 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-300">
          <CalendarOff className="h-3.5 w-3.5 shrink-0" />
          Ce client <span className="font-semibold">ne se fait pas livrer</span> — les bons seront datés <span className="font-semibold">au jour le jour</span>.
        </p>
      )}

      <div className="flex items-center justify-end">
        <Button type="button" size="sm" onClick={save} disabled={!dirty || saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}
