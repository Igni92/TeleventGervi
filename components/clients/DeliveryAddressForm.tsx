"use client";

import { useEffect, useState, useTransition } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Adresse de LIVRAISON structurée — bidirectionnelle avec SAP (adresse
 * « Expédier à » / BPAddresses bo_ShipTo, livraison par défaut). Lue depuis
 * SAP, écrite dans SAP. Calquée sur BillingAddressForm.
 */
type Addr = {
  street: string; block: string; city: string; zipCode: string; county: string; country: string;
};
const EMPTY: Addr = { street: "", block: "", city: "", zipCode: "", county: "", country: "" };

export function DeliveryAddressForm({ clientId }: { clientId: string }) {
  const [initial, setInitial] = useState<Addr | null>(null);
  const [a, setA] = useState<Addr>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/clients/${clientId}/delivery-address`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) {
          const v: Addr = {
            street: d.street ?? "", block: d.block ?? "", city: d.city ?? "",
            zipCode: d.zipCode ?? "", county: d.county ?? "", country: d.country ?? "",
          };
          setInitial(v); setA(v);
        } else setError(d.error ?? "Erreur");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  const dirty = initial != null && (Object.keys(EMPTY) as (keyof Addr)[]).some((k) => a[k] !== initial[k]);
  const set = (k: keyof Addr) => (e: React.ChangeEvent<HTMLInputElement>) => setA((cur) => ({ ...cur, [k]: e.target.value }));

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startSave(async () => {
      const res = await fetch(`/api/clients/${clientId}/delivery-address`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setError(d?.error ?? `Erreur ${res.status}`); toast.error("Échec écriture SAP"); return; }
      setInitial({ ...a });
      toast.success("Adresse de livraison mise à jour (SAP)");
    });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Chargement de l&apos;adresse SAP…</p>;

  return (
    <form onSubmit={onSave} className="space-y-3">
      <div className="space-y-2">
        <Input placeholder="N° et rue" value={a.street} onChange={set("street")} aria-label="Rue" />
        <Input placeholder="Complément (bâtiment, quai, BP…)" value={a.block} onChange={set("block")} aria-label="Complément" />
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Code postal" value={a.zipCode} onChange={set("zipCode")} aria-label="Code postal" />
          <Input placeholder="Ville" value={a.city} onChange={set("city")} className="col-span-2" aria-label="Ville" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Département / région" value={a.county} onChange={set("county")} aria-label="Département" />
          <Input placeholder="Pays (FR)" value={a.country} onChange={set("country")} maxLength={3} aria-label="Pays" />
        </div>
      </div>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <div className="flex items-center justify-end">
        <Button type="submit" size="sm" disabled={!dirty || saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" /> {saving ? "Enregistrement…" : "Enregistrer dans SAP"}
        </Button>
      </div>
    </form>
  );
}
