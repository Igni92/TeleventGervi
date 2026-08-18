"use client";

/**
 * BL — VISUEL + ÉDITION d'un bon de livraison existant (SAP).
 *
 * Ouvert depuis « Ventes du jour » (clic sur la ligne = visuel ; clic droit ou
 * bouton stylo = édition directe). Charge le détail via
 * GET /api/sap/orders/[docEntry] et enregistre les modifications (quantités,
 * prix, n° de commande, commentaire) via PATCH — uniquement si le BL est OUVERT
 * (`editable`). Les lignes non modifiées ne sont pas renvoyées.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Eye, Save, X, PackageOpen, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NumberInput } from "@/components/ui/number-input";

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

interface Line {
  lineNum: number;
  itemCode: string;
  itemName?: string;
  quantity: number;
  price: number;
  lineTotal: number;
  unit?: string;
  warehouse?: string;
  lot?: string | null;
}
interface OrderDetail {
  docEntry: number;
  docNum: number;
  status?: string;
  editable: boolean;
  total: number;
  totalHT: number;
  numAtCard: string;
  dueDate?: string;
  lines: Line[];
}

/** Édition locale d'une ligne (quantité + prix). */
type Draft = Record<number, { quantity: number; price: number }>;

export function BLViewDialog({
  docEntry, docNum, cardName, open, onOpenChange, startEdit = false, onSaved,
}: {
  docEntry: number | null;
  docNum: number | null;
  cardName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  startEdit?: boolean;
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [numAtCard, setNumAtCard] = useState("");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (docEntry == null) return;
    setLoading(true);
    setDetail(null);
    try {
      const r = await fetch(`/api/sap/orders/${docEntry}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as (OrderDetail & { error?: string }) | null;
      if (!r.ok || !j || j.error) { toast.error(j?.error || "BL introuvable"); onOpenChange(false); return; }
      setDetail(j);
      setNumAtCard(j.numAtCard ?? "");
      setComments("");
      setDraft(Object.fromEntries(j.lines.map((l) => [l.lineNum, { quantity: l.quantity, price: l.price }])));
      // Entrée directe en édition (clic droit / stylo) si le BL est modifiable.
      setEditing(startEdit && j.editable);
    } catch {
      toast.error("SAP injoignable — BL non chargé");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }, [docEntry, startEdit, onOpenChange]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Lignes modifiées (quantité ou prix ≠ original) → à envoyer au PATCH.
  const changedLines = useMemo(() => {
    if (!detail) return [];
    return detail.lines
      .filter((l) => {
        const d = draft[l.lineNum];
        return d && (d.quantity !== l.quantity || d.price !== l.price);
      })
      .map((l) => ({ lineNum: l.lineNum, quantity: draft[l.lineNum].quantity, price: draft[l.lineNum].price }));
  }, [detail, draft]);

  const numChanged = detail ? numAtCard.trim() !== (detail.numAtCard ?? "").trim() : false;
  const commentsChanged = comments.trim() !== "";
  const dirty = changedLines.length > 0 || numChanged || commentsChanged;

  const totalHT = useMemo(() => {
    if (!detail) return 0;
    return detail.lines.reduce((s, l) => s + (draft[l.lineNum]?.quantity ?? l.quantity) * (draft[l.lineNum]?.price ?? l.price), 0);
  }, [detail, draft]);

  const save = async () => {
    if (docEntry == null || !dirty) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (changedLines.length) body.lines = changedLines;
      if (numChanged) body.numAtCard = numAtCard.trim();
      if (commentsChanged) body.comments = comments.trim();
      const r = await fetch(`/api/sap/orders/${docEntry}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "Échec de l'enregistrement");
      toast.success(`BL n°${docNum} enregistré.`);
      setEditing(false);
      onSaved?.();
      await load();
    } catch (e) {
      toast.error(`Modification non enregistrée : ${e instanceof Error ? e.message : ""}`);
    } finally { setSaving(false); }
  };

  const closed = detail && !detail.editable;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <PackageOpen className="h-4 w-4 text-brand-600" />
            BL #{docNum ?? "—"}
            <span className="truncate text-muted-foreground font-normal">· {cardName}</span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-[12px]">
            {closed ? (
              <span className="inline-flex items-center gap-1 text-amber-600"><Lock className="h-3 w-3" /> BL clôturé — consultation seule</span>
            ) : detail ? (
              <span className="inline-flex items-center gap-1 text-emerald-600"><PackageOpen className="h-3 w-3" /> BL ouvert — modifiable</span>
            ) : null}
            {detail?.dueDate && <span className="text-muted-foreground">· Livr. {detail.dueDate}</span>}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-10 justify-center text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement du BL…
          </div>
        ) : !detail ? null : (
          <>
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="py-1.5 pr-2 font-semibold">Article</th>
                    <th className="py-1.5 px-2 font-semibold text-right w-[110px]">Qté</th>
                    <th className="py-1.5 px-2 font-semibold text-right w-[120px]">Prix HT</th>
                    <th className="py-1.5 pl-2 font-semibold text-right w-[100px]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => {
                    const q = draft[l.lineNum]?.quantity ?? l.quantity;
                    const p = draft[l.lineNum]?.price ?? l.price;
                    return (
                      <tr key={l.lineNum} className="border-b border-border/50 align-top">
                        <td className="py-1.5 pr-2">
                          <span className="text-foreground">{l.itemName || l.itemCode}</span>
                          <span className="block text-[10.5px] text-muted-foreground">{l.itemCode}{l.unit ? ` · ${l.unit}` : ""}</span>
                        </td>
                        <td className="py-1.5 px-2 text-right tnum">
                          {editing ? (
                            <NumberInput value={q} onValueChange={(n) => setDraft((d) => ({ ...d, [l.lineNum]: { quantity: n ?? 0, price: p } }))}
                              decimals={2} min={0} step={1} className="h-8 w-[92px] text-right" />
                          ) : q.toLocaleString("fr-FR")}
                        </td>
                        <td className="py-1.5 px-2 text-right tnum">
                          {editing ? (
                            <NumberInput value={p} onValueChange={(n) => setDraft((d) => ({ ...d, [l.lineNum]: { quantity: q, price: n ?? 0 } }))}
                              decimals={2} min={0} step={0.1} className="h-8 w-[104px] text-right" />
                          ) : eur.format(p)}
                        </td>
                        <td className="py-1.5 pl-2 text-right tnum font-medium text-foreground">{eur.format(q * p)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* N° commande + commentaire (édition) */}
              {editing && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-[12px]">
                    <span className="block mb-1 text-muted-foreground">N° de commande client</span>
                    <Input value={numAtCard} onChange={(e) => setNumAtCard(e.target.value)} placeholder="Réf. client" className="h-9" />
                  </label>
                  <label className="text-[12px]">
                    <span className="block mb-1 text-muted-foreground">Commentaire (ajouté au BL)</span>
                    <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={1} placeholder="Optionnel" className="min-h-9" />
                  </label>
                </div>
              )}
            </div>

            {/* Pied : total + actions */}
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-3">
              <div className="text-[13px]">
                <span className="text-muted-foreground">Total HT&nbsp;</span>
                <span className="font-semibold text-foreground tnum">{eur.format(totalHT)}</span>
              </div>
              <div className="flex items-center gap-2">
                {editing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => { setEditing(false); setDraft(Object.fromEntries(detail.lines.map((l) => [l.lineNum, { quantity: l.quantity, price: l.price }]))); setNumAtCard(detail.numAtCard ?? ""); setComments(""); }} disabled={saving}>
                      <X className="h-3.5 w-3.5" /> Annuler
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving || !dirty}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Enregistrer
                    </Button>
                  </>
                ) : detail.editable ? (
                  <Button size="sm" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Modifier
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Eye className="h-3.5 w-3.5" /> Consultation</span>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
