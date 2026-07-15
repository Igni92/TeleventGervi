"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Zone d'actions « gestion » d'une fiche fournisseur : archiver / réactiver et
 *  supprimer. La suppression est réservée à la gestion (le bouton n'est rendu
 *  que si `canManage`, et l'API revérifie côté serveur). */
export function SupplierActions({
  supplierId, active, canManage,
}: { supplierId: string; active: boolean; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"archive" | "delete" | null>(null);

  const toggleArchive = async () => {
    setBusy("archive");
    try {
      const res = await fetch(`/api/suppliers/${supplierId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Le PUT exige nom (schéma) — on relit la valeur courante via un GET léger.
        body: JSON.stringify(await patchBody(supplierId, { active: !active })),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Échec");
      toast.success(active ? "Fournisseur archivé" : "Fournisseur réactivé");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!confirm("Supprimer définitivement cette fiche fournisseur et ses contacts ?")) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/suppliers/${supplierId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Échec");
      toast.success("Fournisseur supprimé");
      router.push("/fournisseurs");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={toggleArchive} disabled={busy !== null}>
        {busy === "archive" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
        {active ? "Archiver" : "Réactiver"}
      </Button>
      {canManage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={remove}
          disabled={busy !== null}
          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
        >
          {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Supprimer
        </Button>
      )}
    </div>
  );
}

/** Construit un corps PUT complet (le schéma exige nom) en repartant de la
 *  fiche courante, puis applique le patch demandé. */
async function patchBody(supplierId: string, patch: Record<string, unknown>) {
  const cur = await fetch(`/api/suppliers/${supplierId}`).then((r) => r.json());
  return {
    nom: cur.nom,
    type: cur.type ?? "",
    sapCardCode: cur.sapCardCode ?? "",
    email: cur.email ?? "",
    tel1: cur.tel1 ?? "",
    tel2: cur.tel2 ?? "",
    tel3: cur.tel3 ?? "",
    adresse: cur.adresse ?? "",
    notes: cur.notes ?? "",
    ...patch,
  };
}
