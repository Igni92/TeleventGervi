"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Bouton « Export RGPD » (admin) — déclenche `GET /api/rgpd/export` et télécharge
 * le JSON des données personnelles détenues pour ce client (droit d'accès, art. 15
 * & 20). À réserver aux admins ; l'endpoint renvoie de toute façon 403 sinon.
 */
export function RgpdExportButton({ clientId }: { clientId: string }) {
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/rgpd/export?clientId=${encodeURIComponent(clientId)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();

      const code: string = data?.meta?.cardCode ?? clientId;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rgpd-${code}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("Export RGPD téléchargé");
    } catch {
      toast.error("Export RGPD indisponible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={exportData}
      disabled={busy}
      title="Exporter les données personnelles détenues pour ce client (droit d'accès RGPD)"
      className="gap-1.5"
    >
      {busy ? <Loader2 className="animate-spin" /> : <Download />}
      Export RGPD
    </Button>
  );
}
