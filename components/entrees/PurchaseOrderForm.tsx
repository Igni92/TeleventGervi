"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { todayISO, nowHM } from "@/components/ui/date-stepper";
import {
  DocumentLinesEditor, effPU, type DocLine, type Supplier,
} from "./DocumentLinesEditor";

const LABEL = "text-caption uppercase tracking-wide text-muted-foreground font-semibold";

/** Formulaire de commande fournisseur (CF) — s'embarque dans une feuille
 *  plein écran (« Nouvelle commande »). `onCreated` rafraîchit l'historique. */
export function PurchaseOrderForm({ onCreated }: { onCreated?: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [dueDate, setDueDate] = useState(todayISO());
  const [orderTime, setOrderTime] = useState(nowHM());   // heure de prise de commande
  const [numAtCard, setNumAtCard] = useState("");
  const [comment, setComment] = useState("");
  const [lines, setLines] = useState<DocLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [last, setLast] = useState<number | null>(null);

  const reset = () => { setSupplier(null); setNumAtCard(""); setComment(""); setLines([]); setDueDate(todayISO()); setOrderTime(nowHM()); };

  const submit = async () => {
    if (!supplier) { toast.error("Sélectionne un fournisseur"); return; }
    if (lines.length === 0) { toast.error("Ajoute au moins 1 ligne"); return; }
    if (!dueDate) { toast.error("Date de livraison prévue requise"); return; }
    setSubmitting(true); setLast(null);
    try {
      const res = await fetch("/api/sap/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardCode: supplier.cardCode, dueDate, orderTime: orderTime || undefined, numAtCard: numAtCard.trim() || undefined, comment: comment.trim() || undefined,
          // Payload SAP inchangé : PU /pie (dérivé du total forcé au besoin).
          lines: lines.map((l) => { const pu = effPU(l); return { itemCode: l.itemCode, packageQuantity: l.packageQuantity, warehouseCode: l.warehouseCode, price: pu != null && pu > 0 ? pu : undefined }; }),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error(json.error || "Erreur SAP"); return; }
      toast.success(`Commande fournisseur n°${json.docNum} créée`, { description: `Livraison prévue le ${new Date(dueDate).toLocaleDateString("fr-FR")}` });
      setLast(json.docNum); reset(); onCreated?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-5">
      {last && (
        <Banner tone="success" title={`Dernière commande créée : n° ${last}`}>
          Engagement fournisseur enregistré côté SAP.
        </Banner>
      )}

      <DocumentLinesEditor
        supplier={supplier}
        onSupplierChange={setSupplier}
        date={dueDate}
        onDateChange={setDueDate}
        time={orderTime}
        onTimeChange={setOrderTime}
        dateLabel="Livraison prévue & prise de commande"
        timeLabel="Heure de prise de commande"
        reference={numAtCard}
        onReferenceChange={setNumAtCard}
        referencePlaceholder="N° interne / réf. fournisseur"
        lines={lines}
        onLinesChange={setLines}
      >
        <div className="space-y-1.5">
          <label className={LABEL}>Commentaire (optionnel)</label>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Note libre — visible sur la commande SAP" />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={reset} disabled={submitting}>Vider</Button>
          <Button onClick={submit} disabled={submitting || !supplier || lines.length === 0}>
            {submitting ? <Loader2 className="animate-spin" /> : <PackageCheck />}
            {submitting ? "Création SAP…" : "Créer la commande"}
          </Button>
        </div>
      </DocumentLinesEditor>
    </div>
  );
}
