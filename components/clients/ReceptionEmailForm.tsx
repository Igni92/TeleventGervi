"use client";

import { useEffect, useState, useTransition } from "react";
import { Save, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Email RÉCEPTION (logistique) — déplacé hors de l'onglet Comptabilité.
 * Sert aux confirmations de livraison et litiges réception (quai).
 * Persisté via la même route /compta (mise à jour PARTIELLE — n'écrase pas
 * l'email compta ni l'adresse de facturation).
 */
export function ReceptionEmailForm({ clientId }: { clientId: string }) {
  const [initial, setInitial] = useState<string | null>(null);
  const [email, setEmail] = useState("");
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
        if (d.ok) { setInitial(d.emailReception ?? null); setEmail(d.emailReception ?? ""); }
        else setError(d.error ?? "Erreur");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  const dirty = initial !== null || email !== "" ? (email || null) !== initial : false;

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaved(false);
    startSave(async () => {
      const res = await fetch(`/api/clients/${clientId}/compta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailReception: email || null }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setError(d?.error ?? `Erreur ${res.status}`); return; }
      setInitial(d.emailReception ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <form onSubmit={onSave} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="emailReception" className="inline-flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5 text-muted-foreground" /> Email réception
        </Label>
        <Input
          id="emailReception"
          type="email"
          placeholder="reception@exemple.fr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          Pour les confirmations de livraison et litiges réception (quai marchandise).
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
