"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Resynchronisation GLOBALE et propre du miroir depuis la base réelle (PROD).
 * Vide + reconstruit les docs (factures/avoirs/commandes/PDN/clients) puis
 * rafraîchit le stock. Lectures épinglées PROD quel que soit le badge test/prod.
 */
export function ResyncButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const run = async () => {
    const ok = window.confirm(
      "Resynchroniser TOUTES les données depuis la base réelle (PROD) ?\n\n" +
      "Cela VIDE le miroir (factures, avoirs, commandes, fournisseurs, clients SAP) " +
      "et le reconstruit entièrement, puis rafraîchit le stock.\n\n" +
      "⚠️ Peut prendre 1 à 2 minutes — ne ferme pas l'onglet.",
    );
    if (!ok) return;
    setBusy(true);
    const t = toast.loading("Resynchronisation depuis PROD… (1-2 min)");
    try {
      const r1 = await fetch("/api/sap/sync/full-reset", { method: "POST" });
      const j1 = await r1.json();
      if (!r1.ok || !j1.ok) { toast.error(j1.error || "Échec de la resync", { id: t, duration: 12000 }); return; }
      // Stock / catalogue (séparé)
      const r2 = await fetch("/api/sap/sync/products", { method: "POST" }).catch(() => null);
      toast.success(
        `Resync OK · ${j1.invoices} factures · ${j1.creditNotes} avoirs · ${j1.orders} commandes · ${j1.pdns} PDN · ${j1.businessPartners} clients`
        + (r2 && r2.ok ? " · stock à jour" : " (stock : relance manuelle)"),
        { id: t, duration: 14000 },
      );
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy} className="gap-1">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {busy ? "Resync en cours…" : "Resynchroniser (PROD)"}
    </Button>
  );
}
