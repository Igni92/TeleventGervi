"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, PackagePlus } from "lucide-react";
import { freshnessGroupKey } from "@/lib/freshnessGroups";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { todayISO, nowHM } from "@/components/ui/date-stepper";
import {
  DocumentLinesEditor, effPU, type DocLine, type Supplier, type ProductHit,
} from "./DocumentLinesEditor";

// Pickers/types partagés — ré-exportés pour les imports existants
// (PurchaseOrderHistory, etc.) après extraction dans DocumentLinesEditor.
export { SupplierPicker, ProductPicker } from "./DocumentLinesEditor";
export type { Supplier, ProductHit } from "./DocumentLinesEditor";

/** Date du jour + n jours, au format YYYY-MM-DD (local). */
function plusDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const AFFECT_LABEL = "text-caption uppercase tracking-wide text-muted-foreground font-semibold";

/** Formulaire d'entrée marchandise (EM) — s'embarque dans une feuille
 *  plein écran (« Nouvelle entrée »). `onDone` est appelé après un succès. */
export function GoodsReceiptForm({ onDone }: { onDone?: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [docDate, setDocDate] = useState(todayISO());
  const [docTime, setDocTime] = useState(nowHM());   // heure de réception (agréage)
  const [numAtCard, setNumAtCard] = useState("");
  const [comment, setComment] = useState("");
  // Affectation de l'EM à un segment client — « TOUS » (stock commun, défaut) ou
  // un segment (achat de dernière minute dédié, ex. EXPORT) : réserve le lot au
  // segment et sert ses commandes en premier à la propagation.
  const [affect, setAffect] = useState<"TOUS" | "EXPORT" | "GMS" | "CHR">("TOUS");
  const [lines, setLines] = useState<DocLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{ docNum: number; lot: string } | null>(null);
  // Durées de vie par défaut (jours) → pré-remplit la DDM à l'ajout d'une ligne
  // (= date du jour + jours). Exception article prioritaire sur le défaut du
  // groupe. Réglées dans Paramètres › « Fraîcheur · DDM par défaut ».
  const [shelfLife, setShelfLife] = useState<Record<string, number>>({});
  const [groupDays, setGroupDays] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancel = false;
    fetch("/api/products/shelf-life", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancel || !j) return;
        const map: Record<string, number> = {};
        for (const it of (j.items ?? []) as { itemCode: string; days: number }[]) map[it.itemCode] = it.days;
        setShelfLife(map);
        const gm: Record<string, number> = {};
        for (const g of (j.groups ?? []) as { key: string; days: number | null }[]) {
          if (g.days && g.days > 0) gm[g.key] = g.days;
        }
        setGroupDays(gm);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // DDM par défaut : exception article si définie, sinon défaut du groupe de fruits.
  const makeDefaultDlc = (p: ProductHit): string => {
    const sl = shelfLife[p.itemCode] ?? groupDays[freshnessGroupKey(p.itemName)];
    return sl && sl > 0 ? plusDaysISO(sl) : "";
  };

  const reset = () => {
    setSupplier(null); setDocDate(todayISO()); setDocTime(nowHM()); setNumAtCard(""); setComment(""); setLines([]); setAffect("TOUS");
  };

  // Clé d'idempotence : STABLE tant que la réception n'a pas abouti (un retry après
  // échec réseau rejoue la MÊME clé → le serveur ne crée pas un 2ᵉ BR). Régénérée
  // seulement après un succès (nouvelle réception = nouvelle clé).
  const idemKeyRef = useRef<string | null>(null);

  const submit = async () => {
    if (!supplier) { toast.error("Sélectionne un fournisseur"); return; }
    if (lines.length === 0) { toast.error("Ajoute au moins 1 ligne"); return; }
    for (const l of lines) {
      if (!l.packageQuantity || l.packageQuantity <= 0) {
        toast.error(`Quantité (colis) invalide sur ${l.itemCode}`);
        return;
      }
    }
    if (!idemKeyRef.current) {
      idemKeyRef.current = (globalThis.crypto?.randomUUID?.() ?? `gr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    setSubmitting(true);
    setLastReceipt(null);
    try {
      const res = await fetch("/api/sap/goods-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardCode: supplier.cardCode,
          idempotencyKey: idemKeyRef.current,
          docDate: docDate || undefined,
          docTime: docTime || undefined,
          numAtCard: numAtCard.trim() || undefined,
          comment: comment.trim() || undefined,
          affect,
          lines: lines.map((l) => {
            // PU effectif : dérivé du TOTAL HT forcé quand saisi (facture), sinon PU tapé.
            const pu = effPU(l);
            return {
              itemCode: l.itemCode,
              packageQuantity: l.packageQuantity,
              warehouseCode: l.warehouseCode,
              price: pu != null && pu > 0 ? pu : undefined,
              rating: l.note ?? undefined,
            };
          }),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error || "Erreur SAP");
        return;
      }
      const retro = json.retroPatchedLines as number | undefined;
      toast.success(`BR n°${json.docNum} créé — lot ${json.lot}`, {
        description: retro && retro > 0
          ? `${lines.length} ligne(s) — stock incrémenté. ${retro} BL ouvert(s) du jour relié(s) à ce lot.`
          : `${lines.length} ligne(s) — stock incrémenté.`,
      });

      // ── DDM (fraîcheur) : best-effort, ne bloque JAMAIS la réception ──
      // Le n° de lot créé est exposé par l'API : json.lot === "EM<DocNum>". On
      // POST chaque DDM saisie vers /api/lots/dlc. Une seule DDM par lot (toutes
      // les lignes de cette EM partagent le même batchNumber).
      const batchNumber: string | undefined =
        typeof json.lot === "string" && json.lot
          ? json.lot
          : (typeof json.docNum === "number" ? `EM${json.docNum}` : undefined);
      const dlcLines = lines.filter((l) => l.dlc.trim() !== "");
      if (batchNumber && dlcLines.length > 0) {
        const results = await Promise.allSettled(
          dlcLines.map((l) =>
            fetch("/api/lots/dlc", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ batchNumber, itemCode: l.itemCode, expirationDate: l.dlc }),
            }).then((r) => { if (!r.ok) throw new Error(String(r.status)); }),
          ),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed === 0) {
          toast.info(`Fraîcheur enregistrée pour le lot ${batchNumber} (${dlcLines.length} DDM).`);
        } else {
          toast.info(`Réception OK — ${dlcLines.length - failed}/${dlcLines.length} DDM enregistrée(s) (le reste a échoué, sans impact sur l'entrée).`);
        }
      } else if (!batchNumber && dlcLines.length > 0) {
        toast.info("Réception créée, mais le n° de lot n'a pas été renvoyé : DDM non enregistrée(s).");
      }

      setLastReceipt({ docNum: json.docNum, lot: json.lot });
      idemKeyRef.current = null;   // succès → la prochaine réception aura une nouvelle clé
      reset();
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {lastReceipt && (
        <Banner tone="success" title={`Dernier BR n° ${lastReceipt.docNum} · lot ${lastReceipt.lot}`}>
          Propagé au résolveur de lots.
        </Banner>
      )}

      <DocumentLinesEditor
        supplier={supplier}
        onSupplierChange={setSupplier}
        date={docDate}
        onDateChange={setDocDate}
        time={docTime}
        onTimeChange={setDocTime}
        dateLabel="Date & heure de réception"
        timeLabel="Heure de réception"
        reference={numAtCard}
        onReferenceChange={setNumAtCard}
        lines={lines}
        onLinesChange={setLines}
        makeDefaultDlc={makeDefaultDlc}
        showDDM
        showNote
        headerExtra={
          // Affectation de l'arrivage : « Tous » = stock commun ; un segment =
          // achat dédié (ex. export). SegmentedControl NEUTRE — la couleur pleine
          // par segment est abandonnée (le fond ne code pas une identité ici).
          <div className="space-y-1.5">
            <label className={AFFECT_LABEL}>Affecté à</label>
            <SegmentedControl
              aria-label="Affectation de l'arrivage"
              value={affect}
              onChange={(v) => setAffect(v as typeof affect)}
              options={[
                { value: "TOUS", label: "Tous" },
                { value: "EXPORT", label: "Export" },
                { value: "GMS", label: "GMS" },
                { value: "CHR", label: "CHR" },
              ]}
              className="max-w-md"
            />
            {affect !== "TOUS" && (
              <p className="text-caption text-muted-foreground">
                Ce lot sera réservé aux clients <b>{affect}</b> (télévente) et leurs commandes en attente
                seront reliées à ce lot en premier.
              </p>
            )}
          </div>
        }
      >
        <div className="space-y-1.5">
          <label className={AFFECT_LABEL}>Commentaire (optionnel)</label>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Note libre — visible sur le BR SAP" />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={reset} disabled={submitting}>Vider</Button>
          <Button onClick={submit} disabled={submitting || !supplier || lines.length === 0}>
            {submitting ? <Loader2 className="animate-spin" /> : <PackagePlus />}
            {submitting ? "Création SAP…" : "Valider l'entrée"}
          </Button>
        </div>
      </DocumentLinesEditor>
    </div>
  );
}
