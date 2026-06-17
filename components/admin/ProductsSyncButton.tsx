"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Synchronise le catalogue produits + le stock depuis SAP (/api/sap/sync/products).
 * Action admin ponctuelle — le stock « live » est rafraîchi en continu par la
 * console (sync delta), ceci sert au rafraîchissement complet du catalogue.
 */
export function ProductsSyncButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const run = async () => {
    setBusy(true);
    const t = toast.loading("Synchronisation produits & stock…");
    try {
      const r = await fetch("/api/sap/sync/products", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        toast.error(j.error || "Échec de la synchro produits", { id: t, duration: 10000 });
        return;
      }
      toast.success("Produits & stock à jour", { id: t, duration: 8000 });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy} className="gap-1">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
      {busy ? "Synchro…" : "Synchroniser produits & stock"}
    </Button>
  );
}
