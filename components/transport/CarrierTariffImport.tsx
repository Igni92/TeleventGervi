"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Bouton d'IMPORT d'un fichier tarif transporteur (.xlsx Delanchy / Antoine).
 * Un simple dépôt du fichier reconstruit la grille PAR POSITION du (des)
 * transporteur(s) concerné(s) — auto-détection du format et auto-affectation
 * aux codes du catalogue (DELANCHY/FT86, ANTOINE). Le coût de transport de
 * TOUS les clients en découle (département × tranche de poids).
 * Réservé direction/admin (la route revalide).
 */
export function CarrierTariffImport({ onImported }: { onImported?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function importFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/transport/tarifs/import", { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de l'import");
      const label = j.format === "delanchy" ? "Delanchy" : "Antoine";
      toast.success(
        `Tarif ${label} importé → ${(j.applied as string[]).join(", ")} · ${j.zones} zones, ${j.brackets} tranches`,
        { description: j.matched ? undefined : "Aucun transporteur du catalogue ne correspondait — grille enregistrée sous le code générique." },
      );
      for (const w of (j.warnings as string[]) ?? []) toast.warning(w);
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'import");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[11px]"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title="Déposer le fichier tarif du transporteur (xlsx Delanchy ou Antoine) — la grille de tous les clients est mise à jour"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
        Importer tarif Excel
      </Button>
    </>
  );
}
