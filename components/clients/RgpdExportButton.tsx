"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";

/**
 * Bouton « Export RGPD » (admin) — déclenche `GET /api/rgpd/export` et télécharge
 * le JSON des données personnelles détenues pour ce client (droit d'accès, art. 15
 * & 20). Affiché seulement aux admins ; l'endpoint renvoie de toute façon 403 sinon.
 */
export function RgpdExportButton({ clientId, clientCode }: { clientId: string; clientCode: string }) {
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setBusy(true);
    try {
      const res = await fetch(`/api/rgpd/export?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rgpd-${clientCode}-${new Date().toISOString().slice(0, 10)}.json`;
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
    <button
      type="button"
      onClick={exportData}
      disabled={busy}
      title="Exporter les données personnelles détenues pour ce client (droit d'accès RGPD)"
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium border border-border text-muted-foreground hover:text-foreground hover:border-brand-400/60 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Export RGPD
    </button>
  );
}
