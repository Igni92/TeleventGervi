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
 *
 * Fenêtre = défaut serveur = 1er janvier de N-2 (≈ 3 ans), soit la profondeur du
 * rapport annuel (matrice N-2 / N-1 / N). Auparavant limitée à 1 an, ce qui
 * laissait 2024 et le début 2025 vides dans la matrice comptable.
 */
export function ResyncButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const run = async () => {
    const ok = window.confirm(
      "Resynchroniser TOUTES les données depuis la base réelle (PROD) ?\n\n" +
      "Cela VIDE le miroir (factures, avoirs, commandes, fournisseurs, clients SAP) " +
      "et le reconstruit sur ~3 ans (depuis janvier " + (new Date().getFullYear() - 2) + "), " +
      "profondeur du rapport annuel, puis rafraîchit le stock.\n\n" +
      "⚠️ Peut prendre plusieurs minutes (historique 3 ans) — ne ferme pas l'onglet.",
    );
    if (!ok) return;
    setBusy(true);
    const t = toast.loading("Resynchronisation depuis PROD… (historique 3 ans, quelques minutes)");
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
