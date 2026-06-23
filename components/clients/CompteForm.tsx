"use client";

import { useEffect, useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Onglet Comptabilité de la fiche client (B6).
 * Email comptabilité + adresse de facturation. Distincts de l'email
 * commercial (vit sur Contact, cf. B7) et de l'adresse de livraison
 * (vit côté SAP via ClientDeliveryMode).
 */

type Compta = {
  emailCompta: string | null;
};

export function CompteForm({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Compta | null>(null);
  const [emailCompta, setEmailCompta] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/clients/${clientId}/compta`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) {
          setData({ emailCompta: d.emailCompta ?? null });
          setEmailCompta(d.emailCompta ?? "");
        } else {
          setError(d.error ?? "Erreur");
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  const dirty = data != null && (emailCompta || null) !== data.emailCompta;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startSave(async () => {
      const res = await fetch(`/api/clients/${clientId}/compta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailCompta: emailCompta || null }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setError(d?.error ?? `Erreur ${res.status}`);
        return;
      }
      setData({ emailCompta: d.emailCompta ?? null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="emailCompta">Email comptabilité</Label>
        <Input
          id="emailCompta"
          type="email"
          placeholder="compta@exemple.fr"
          value={emailCompta}
          onChange={(e) => setEmailCompta(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          Pour les factures et relances — distinct des emails des interlocuteurs (onglet Commercial).
        </p>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-emerald-500">Enregistré ✓</span>}
        <Button type="submit" disabled={!dirty || saving} size="sm" className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
