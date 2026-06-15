"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, DownloadCloud, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Import des clients SAP non gelés → base locale. Deux modes :
 *   • Actualiser (clear=false) — NON destructif : ajoute les nouveaux clients et
 *     rafraîchit nom/type/tél/groupe + localisation (ville/CP/pays). Préserve les
 *     contacts, appels, rappels, modes de livraison, incidents et les
 *     affectations manuelles (commercial/vendeur/jours). À utiliser pour peupler
 *     la carte « Où je livre le plus » sans rien perdre.
 *   • Réimport complet (clear=true) — DESTRUCTIF : vide d'abord toute la base
 *     clients locale (cascade) et repart de zéro. Auto-active les U_Actif='O'.
 */
export function ClientImportButton() {
  const [busy, setBusy] = useState<null | "refresh" | "clear">(null);
  const router = useRouter();

  const run = async (clear: boolean) => {
    const ok = clear
      ? window.confirm(
          "Réimport COMPLET des clients SAP non gelés ?\n\n" +
          "⚠️ Action destructive : cela VIDE d'abord la base clients locale " +
          "(clients, appels, rappels, contacts, modes de livraison, incidents) " +
          "et repart de zéro.\n\nLes clients à U_Actif='O' dans SAP seront activés " +
          "automatiquement ; les autres devront être activés à la main.",
        )
      : window.confirm(
          "Actualiser la base clients depuis SAP ?\n\n" +
          "Ajoute les nouveaux clients et rafraîchit nom, type, téléphone, groupe " +
          "et la localisation (ville / code postal / pays — pour la carte).\n\n" +
          "Ne supprime rien : contacts, appels, rappels et affectations manuelles " +
          "sont conservés.",
        );
    if (!ok) return;
    setBusy(clear ? "clear" : "refresh");
    try {
      const r = await fetch("/api/sap/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec de l'import"); return; }
      toast.success(
        `${j.pulled} clients ${clear ? "importés" : "synchronisés"} (${j.company}) · ` +
        `${j.activated} actifs · ${j.manual} à activer · ${j.gms} en GMS`,
        { duration: 10000 },
      );
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => run(false)} disabled={busy !== null}>
        {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {busy === "refresh" ? "Actualisation…" : "Actualiser depuis SAP"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => run(true)}
        disabled={busy !== null}
        className="text-muted-foreground hover:text-rose-500"
        title="Réimport complet — vide d'abord toute la base clients locale"
      >
        {busy === "clear" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
        {busy === "clear" ? "Réimport…" : "Réimport complet"}
      </Button>
    </div>
  );
}
