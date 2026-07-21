"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Synchro INCRÉMENTALE du miroir documents (ventes/commandes/factures/EM) depuis
 * SAP — POST /api/sap/sync/mirror (auth session admin). Récupère les tout derniers
 * documents (`UpdateDate > curseur`), donc l'activité DU JOUR, sans attendre le
 * planificateur (cf. .github/workflows/sap-sync.yml).
 *
 * Filet de sécurité opérationnel : si l'ordonnanceur externe tombe, un admin
 * remet les KPI du jour à jour en un clic (la matrice historique, elle, reste
 * gérée par le backfill mois par mois juste au-dessus).
 */
export function MirrorSyncButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const run = async () => {
    setBusy(true);
    const t = toast.loading("Synchronisation ventes & commandes…");
    try {
      const r = await fetch("/api/sap/sync/mirror", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        toast.error(j.error || "Échec de la synchro miroir", { id: t, duration: 10000 });
        return;
      }
      if (j.throttled) {
        toast.info("Déjà synchronisé à l'instant — réessaie dans 1 min", { id: t, duration: 6000 });
        return;
      }
      const n = (j.orders ?? 0) + (j.invoices ?? 0) + (j.creditNotes ?? 0) + (j.pdns ?? 0);
      toast.success(
        n > 0 ? `À jour — ${n} document(s) récupéré(s)` : "À jour — rien de nouveau",
        { id: t, duration: 8000 },
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
      {busy ? "Synchro…" : "Synchroniser maintenant"}
    </Button>
  );
}
