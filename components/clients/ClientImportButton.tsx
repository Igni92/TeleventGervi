"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, DownloadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Import des clients SAP non gelés → base locale (clear + repart de zéro).
 * Auto-activation des clients à U_Actif='O'. Action destructive : confirmation.
 */
export function ClientImportButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const run = async () => {
    const ok = window.confirm(
      "Importer tous les clients SAP non gelés ?\n\n" +
      "⚠️ Cela VIDE d'abord la base clients locale (clients, appels, rappels, " +
      "contacts, modes de livraison, incidents) et repart de zéro.\n\n" +
      "Les clients à U_Actif='O' dans SAP seront activés automatiquement ; " +
      "les autres devront être activés à la main.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch("/api/sap/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec de l'import"); return; }
      toast.success(
        `${j.pulled} clients importés (${j.company}) · ${j.activated} activés d'office · ${j.manual} à activer · ${j.gms} en GMS`,
        { duration: 10000 },
      );
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
      {busy ? "Import en cours…" : "Importer les clients SAP"}
    </Button>
  );
}
