"use client";

/**
 * ÉDITION BL — liste tous les BONS DE LIVRAISON SAP (DeliveryNotes) d'une date
 * de livraison (DocDueDate) et les imprime au format OFFICIEL (réplique du
 * layout SAP/coresuite — lib/blOfficiel). Remplace la sortie « état coresuite »
 * lancée depuis SAP : les données restent 100 % SAP, TeleVent ne fait que la
 * mise en page et l'impression.
 *
 * Filtre par segment televente (GMS / CHR / EXPORT), sélection par BL, et
 * impression GROUPÉE : tous les BL cochés partent dans UNE seule fenêtre →
 * un seul job d'impression (chaque BL enchaîne ses pages officielles).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Printer, FileText, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { nextDeliveryDate, formatDeliveryDate } from "@/lib/livraison";
import { DateStepper } from "@/components/ui/date-stepper";
import { renderBlOfficiel, blPageCount, type BlDoc } from "@/lib/blOfficiel";

const SEGMENTS = ["GMS", "CHR", "EXPORT"] as const;
type Segment = (typeof SEGMENTS)[number];
type SegFilter = "TOUS" | Segment;

type ApiDoc = BlDoc & { docEntry: number; cardCode: string; clientType: string | null };
interface ApiResp { ok?: boolean; date?: string; count?: number; docs?: ApiDoc[]; error?: string }

const SEG_BADGE: Record<string, string> = {
  GMS: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  CHR: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  EXPORT: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

const nfColis = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const nfKg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nfEur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** Ouvre la fenêtre d'impression avec les BL donnés (un seul job). */
function printDocs(docs: ApiDoc[]): boolean {
  if (typeof window === "undefined" || docs.length === 0) return false;
  const html = renderBlOfficiel(docs, {
    logoUrl: `${window.location.origin}/LogoSansFond.png`,
    title: docs.length === 1 ? `BL n°${docs[0].docNum}` : `Édition BL — ${docs.length} bons`,
  });
  const w = window.open("", "_blank", "width=920,height=1050");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

export function EditionBlPanel() {
  const [date, setDate] = useState(() => nextDeliveryDate());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [seg, setSeg] = useState<SegFilter>("TOUS");
  // Sélection par DocEntry — par défaut TOUT est coché à chaque chargement.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bl-edition?date=${d}`, { cache: "no-store" });
      const j: ApiResp = await r.json().catch(() => ({}));
      if (j?.ok) {
        setData(j);
        setSelected(new Set((j.docs ?? []).map((doc) => doc.docEntry)));
      } else {
        setData(null);
        toast.error(j?.error || "BL indisponibles");
      }
    } catch {
      setData(null);
      toast.error("SAP injoignable — BL non chargés");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const allDocs = useMemo(() => data?.docs ?? [], [data]);
  const segCount = useCallback(
    (s: Segment) => allDocs.filter((d) => d.clientType === s).length,
    [allDocs],
  );
  const docs = useMemo(
    () => (seg === "TOUS" ? allDocs : allDocs.filter((d) => d.clientType === seg)),
    [allDocs, seg],
  );
  const shown = docs.filter((d) => selected.has(d.docEntry));
  const allShownSelected = docs.length > 0 && shown.length === docs.length;
  const totalPages = shown.reduce((s, d) => s + blPageCount(d.lines.length), 0);

  const toggle = (docEntry: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(docEntry)) next.delete(docEntry); else next.add(docEntry);
      return next;
    });
  const toggleAllShown = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allShownSelected) docs.forEach((d) => next.delete(d.docEntry));
      else docs.forEach((d) => next.add(d.docEntry));
      return next;
    });

  const print = (list: ApiDoc[]) => {
    if (list.length === 0) { toast.info("Aucun BL sélectionné."); return; }
    if (!printDocs(list)) toast.error("Impression bloquée — autorise les fenêtres pop-up.");
  };

  return (
    <div className="space-y-4">
      {/* Contrôles : date + segment + actualiser + imprimer */}
      <div className="flex flex-wrap items-center gap-2">
        <DateStepper value={date} onChange={setDate} className="shrink-0" />
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-0.5 shrink-0">
          {(["TOUS", ...SEGMENTS] as SegFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeg(s)}
              className={`h-9 px-3 rounded-lg text-[12.5px] font-medium transition-colors ${
                seg === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "TOUS" ? `Tous (${allDocs.length})` : `${s} (${segCount(s as Segment)})`}
            </button>
          ))}
        </div>
        <button
          type="button" onClick={() => load(date)} disabled={loading}
          className="inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
        <button
          type="button"
          onClick={() => print(shown)}
          disabled={loading || shown.length === 0}
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-foreground text-background text-[12.5px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          title="Imprimer tous les BL cochés (un seul job d'impression, format officiel SAP)"
        >
          <Printer className="h-4 w-4" />
          Imprimer {shown.length > 0 ? `${shown.length} BL (${totalPages} p.)` : ""}
        </button>
      </div>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400">
              <FileText className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-foreground leading-tight">
                Bons de livraison — {formatDeliveryDate(data?.date ?? date)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {loading && !data
                  ? "Chargement…"
                  : `${docs.length} BL${seg !== "TOUS" ? ` ${seg}` : ""} · format officiel SAP (date de livraison)`}
              </p>
            </div>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lecture des bons de livraison SAP…
          </div>
        ) : docs.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted-foreground text-center">
            Aucun bon de livraison{seg !== "TOUS" ? ` ${seg}` : ""} pour cette date.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 w-10">
                    <button type="button" onClick={toggleAllShown} className="align-middle" aria-label="Tout cocher / décocher">
                      {allShownSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-2 py-2">BL n°</th>
                  <th className="px-2 py-2">Client</th>
                  <th className="px-2 py-2">Segment</th>
                  <th className="px-2 py-2 text-right">Lignes</th>
                  <th className="px-2 py-2 text-right">Colis</th>
                  <th className="px-2 py-2 text-right">Poids</th>
                  <th className="px-2 py-2 text-right">Total HT</th>
                  <th className="px-2 py-2 text-right">Pages</th>
                  <th className="px-3 py-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.docEntry} className="border-b border-border/60 last:border-0 hover:bg-secondary/40 transition-colors">
                    <td className="px-4 py-2">
                      <button type="button" onClick={() => toggle(d.docEntry)} aria-label={`Sélectionner le BL ${d.docNum}`}>
                        {selected.has(d.docEntry) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-muted-foreground/60" />}
                      </button>
                    </td>
                    <td className="px-2 py-2 font-medium tabular-nums">{d.docNum}</td>
                    <td className="px-2 py-2 max-w-[260px] truncate" title={d.clientName}>{d.clientName}</td>
                    <td className="px-2 py-2">
                      {d.clientType ? (
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${SEG_BADGE[d.clientType] ?? "bg-secondary text-muted-foreground"}`}>
                          {d.clientType}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{d.lines.length}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nfColis.format(d.totalColis)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nfKg.format(d.totalWeightKg)} kg</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nfEur.format(d.totalHt)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{blPageCount(d.lines.length)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => print([d])}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        title={`Imprimer le BL n°${d.docNum} (format officiel)`}
                        aria-label={`Imprimer le BL n°${d.docNum}`}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
