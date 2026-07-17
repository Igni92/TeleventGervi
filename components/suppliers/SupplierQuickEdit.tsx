"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import type { SupplierFormValues } from "@/lib/validations";

type FormData = SupplierFormValues & { id: string; active: boolean };

/** Édition RAPIDE d'un fournisseur depuis la liste (clic droit → Modifier), sans
 *  ouvrir la fiche. Récupère la fiche complète puis réutilise SupplierForm. */
export function SupplierQuickEdit({
  id, onClose, onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/suppliers/${id}`, { cache: "no-store" });
        const s = await res.json();
        if (cancelled || !res.ok) return;
        setData({
          id: s.id,
          code: s.code,
          nom: s.nom,
          type: s.type || "",
          sapCardCode: s.sapCardCode || "",
          email: s.email || "",
          tel1: s.tel1 || "",
          tel2: s.tel2 || "",
          tel3: s.tel3 || "",
          adresse: s.adresse || "",
          notes: s.notes || "",
          active: s.active,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifier le fournisseur{data ? ` — ${data.nom}` : ""}</DialogTitle>
          <DialogDescription>
            Renseignez les infos sans ouvrir la fiche. Les achats restent gérés dans SAP.
          </DialogDescription>
        </DialogHeader>
        {loading || !data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SupplierForm
            mode="edit"
            initialData={data}
            onSaved={() => { onSaved(); onClose(); }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
