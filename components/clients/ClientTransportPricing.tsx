"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normCarrier, type ClientCarrierPricing } from "@/lib/transportCost";

/**
 * Tarif transport PAR TRANSPORTEUR pour CE client (transporteurs non directs).
 *
 * Un client peut avoir plusieurs transporteurs possibles ; chacun porte son
 * propre prix au kilo, saisi ici. Les transporteurs « en direct » (flotte
 * propre) ne sont pas saisissables : ils sont valorisés au prix position global
 * (Pilotage › Coût de transport). Best-effort : si l'historique SAP du client
 * est indisponible, on retombe sur le catalogue complet des transporteurs.
 */

interface CarrierOpt { code: string; name: string }

export function ClientTransportPricing({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [carriers, setCarriers] = useState<CarrierOpt[]>([]);
  const [directSet, setDirectSet] = useState<Set<string>>(new Set());
  const [pricing, setPricing] = useState<ClientCarrierPricing>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    // 1) Transporteurs du client (repli catalogue complet), 2) directs + 3) tarifs.
    const [carriersRes, modelRes, pricingRes] = await Promise.allSettled([
      (async () => {
        const r = await fetch(`/api/clients/${clientId}/carriers`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        let list: CarrierOpt[] = ((j?.carriers ?? []) as { name: string; sapValue?: string | null }[])
          .filter((c) => c.sapValue && c.sapValue.trim())
          .map((c) => ({ code: c.sapValue!.trim(), name: c.name || c.sapValue!.trim() }));
        if (list.length === 0) {
          const r2 = await fetch(`/api/carriers`, { cache: "no-store" });
          const j2 = await r2.json().catch(() => null);
          list = ((j2?.carriers ?? []) as { name: string; sapValue?: string | null; active?: boolean }[])
            .filter((c) => c.active !== false && c.sapValue && c.sapValue.trim())
            .map((c) => ({ code: c.sapValue!.trim(), name: c.name || c.sapValue!.trim() }));
        }
        return list;
      })(),
      fetch(`/api/transport/model`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/clients/${clientId}/transport-pricing`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (carriersRes.status === "fulfilled") setCarriers(carriersRes.value);
    if (modelRes.status === "fulfilled" && Array.isArray(modelRes.value?.model?.directCarriers)) {
      setDirectSet(new Set((modelRes.value.model.directCarriers as string[]).map(normCarrier)));
    }
    if (pricingRes.status === "fulfilled" && pricingRes.value?.pricing) setPricing(pricingRes.value.pricing);
  }, [clientId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const setVal = (code: string, val: number) => {
    const k = normCarrier(code);
    setPricing((p) => {
      const next = { ...p };
      if (val > 0) next[k] = val; else delete next[k];
      return next;
    });
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/transport-pricing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec");
      setPricing(j.pricing ?? {});
      setDirty(false);
      toast.success("Tarifs transport enregistrés");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-16 flex items-center text-[12px] text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Chargement des transporteurs…</div>;
  }

  const external = carriers.filter((c) => !directSet.has(normCarrier(c.code)));
  const directOnes = carriers.filter((c) => directSet.has(normCarrier(c.code)));

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground inline-flex items-center gap-1.5 mb-2">
        <Truck className="h-3.5 w-3.5" /> Tarif par transporteur (€/kg)
      </p>

      {carriers.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Aucun transporteur connu pour ce client.</p>
      ) : (
        <ul className="space-y-1.5">
          {directOnes.map((c) => (
            <li key={normCarrier(c.code)} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-foreground">{c.name}</span>
              <span className="shrink-0 text-[11px] font-semibold text-brand-600 dark:text-brand-400 inline-flex items-center gap-1">
                <Truck className="h-3 w-3" /> Direct · prix position
              </span>
            </li>
          ))}
          {external.map((c) => {
            const k = normCarrier(c.code);
            return (
              <li key={k} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-foreground truncate">{c.name}</p>
                  <p className="text-[10.5px] text-muted-foreground truncate">Code {c.code}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number" min={0} step={0.01}
                    className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-[13px] tnum text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    placeholder="0.000"
                    value={pricing[k] ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => setVal(c.code, parseFloat(e.target.value) || 0)}
                    aria-label={`Tarif €/kg pour ${c.name}`}
                  />
                  <span className="text-[11px] text-muted-foreground">€/kg</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && external.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={save} disabled={saving || !dirty} variant={dirty ? "default" : "secondary"}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer les tarifs
          </Button>
        </div>
      )}
    </div>
  );
}
