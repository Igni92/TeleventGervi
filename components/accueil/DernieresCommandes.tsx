"use client";

import { useCallback, useState } from "react";
import { Boxes, Scale, History, FileText, Loader2, ChevronRight, Search, X } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClientLink } from "@/components/ClientLink";
import { useJson } from "./use-json";

/**
 * Dernières commandes SAP créées (GET /api/sap/orders?last=8).
 *
 * - Les icônes (colis / poids) apparaissent UNE seule fois en tête de colonne ;
 *   chaque ligne ne porte que les valeurs, en tags bleus.
 * - Un clic sur une ligne OUVRE le bon de livraison (dialogue détaillé, lignes
 *   chargées via /api/sap/orders/[docEntry]).
 */

interface OrderDoc {
  docEntry?: number;
  docNum?: number;
  docDate?: string;
  dueDate?: string;
  cardCode?: string;
  cardName?: string;
  colis?: number | null;
  weightKg?: number | null;
  total?: number;
  totalHT?: number;
  numAtCard?: string;
  status?: string;
  invoiceNum?: number | null;
}
interface OrdersResponse { docs?: OrderDoc[] }
interface OrderLine {
  lineNum: number; itemCode: string; itemName?: string; quantity: number;
  price: number; lineTotal: number; unit?: string; warehouse?: string; lot?: string | null;
}

/** SAP DocDate est une date SANS heure → on l'affiche en jj/mm (pas d'heure
 *  fantôme « 02:00 » due au décalage UTC→Paris de minuit). */
function dateOf(d: OrderDoc): string {
  if (!d.docDate) return "—";
  const [, m, day] = d.docDate.slice(0, 10).split("-");
  return day && m ? `${day}/${m}` : "—";
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmt2 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDateLong = (d?: string) => (d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const TAG = "inline-flex items-center justify-center whitespace-nowrap rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 px-2 h-5 min-w-[2.25rem] text-[11px] font-semibold tnum";

export function DernieresCommandes() {
  // Recherche par CODE client (CardCode SAP) : vide = les 8 dernières globales ;
  // sinon les dernières commandes de ce compte. Enter/loupe valide, croix réinit.
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const url = query
    ? `/api/sap/orders?cardCode=${encodeURIComponent(query)}&last=12`
    : "/api/sap/orders?last=8";
  const { data, state } = useJson<OrdersResponse>(url, 60_000);
  const docs = (data?.docs ?? []).slice(0, query ? 12 : 8);
  const submit = (e: React.FormEvent) => { e.preventDefault(); setQuery(term.trim().toUpperCase()); };
  const clear = () => { setTerm(""); setQuery(""); };

  // BL ouvert (dialogue) + ses lignes (chargées à la demande).
  const [open, setOpen] = useState<OrderDoc | null>(null);
  const [lines, setLines] = useState<OrderLine[] | null>(null);
  const [linesErr, setLinesErr] = useState(false);

  const openBL = useCallback(async (d: OrderDoc) => {
    setOpen(d); setLines(null); setLinesErr(false);
    if (d.docEntry == null) { setLinesErr(true); return; }
    try {
      const r = await fetch(`/api/sap/orders/${d.docEntry}`).then((x) => x.json());
      if (r.ok === false) throw new Error(r.error);
      setLines(r.lines ?? []);
    } catch { setLinesErr(true); }
  }, []);

  return (
    <SurfaceCard title="Dernières commandes" icon={<History className="h-3.5 w-3.5" />} accent="sky" delay={140}>
      {/* Recherche par CODE client (CardCode SAP) — vide = 8 dernières globales. */}
      <form onSubmit={submit} className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Code client (ex. APLAI)…"
            aria-label="Rechercher les commandes d'un code client"
            className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-[13px] uppercase placeholder:normal-case placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          {(term || query) && (
            <button type="button" onClick={clear} aria-label="Effacer" title="Effacer"
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button type="submit"
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[12.5px] font-semibold transition-colors">
          <Search className="h-3.5 w-3.5" /> Chercher
        </button>
      </form>
      {query && (
        <p className="-mt-1 mb-2 text-[11.5px] text-muted-foreground">
          Commandes du client <span className="font-mono font-semibold text-foreground">{query}</span>
        </p>
      )}

      {state === "loading" && (
        <ul className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => <li key={i} className="h-8 rounded-lg bg-secondary/60 animate-pulse" />)}
        </ul>
      )}

      {state === "error" && (
        <p className="text-[12px] text-muted-foreground py-3 text-center">Commandes SAP indisponibles pour le moment.</p>
      )}

      {state === "ok" && docs.length === 0 && (
        <p className="text-[12px] text-muted-foreground py-3 text-center">
          {query ? `Aucune commande pour le code « ${query} ».` : "Aucune commande récente."}
        </p>
      )}

      {state === "ok" && docs.length > 0 && (
        <>
          {/* En-tête de colonnes : icônes une seule fois */}
          <div className="flex items-center gap-3 pb-1.5 mb-0.5 border-b border-border/60 text-muted-foreground">
            <span className="w-[44px] shrink-0" />
            <span className="flex-1 min-w-0" />
            <span className="w-12 shrink-0 flex justify-center" title="Nombre de colis"><Boxes className="h-4 w-4" /></span>
            <span className="w-16 shrink-0 flex justify-center" title="Poids (kg)"><Scale className="h-4 w-4" /></span>
            <span className="w-4 shrink-0" />
          </div>
          <ul className="divide-y divide-border/60">
            {docs.map((d) => (
              <li key={d.docEntry ?? `${d.docNum}-${d.cardCode}`}>
                <button
                  type="button"
                  onClick={() => openBL(d)}
                  title={`Ouvrir le bon de livraison${d.docNum ? ` # ${d.docNum}` : ""}`}
                  className="w-full flex items-center gap-3 py-1.5 -mx-1 px-1 rounded-md hover:bg-secondary/50 transition-colors text-left group"
                >
                  <span className="tnum shrink-0 w-[44px] text-[11px] font-medium text-muted-foreground">{dateOf(d)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                    {d.cardName || d.cardCode || "—"}
                  </span>
                  <span className="w-12 shrink-0 flex justify-center">
                    {d.colis != null && d.colis > 0 ? <span className={TAG}>{fmtNum(d.colis)}</span> : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                  </span>
                  <span className="w-16 shrink-0 flex justify-center">
                    {d.weightKg != null && d.weightKg > 0 ? <span className={TAG}>{fmtNum(d.weightKg)} kg</span> : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── Bon de livraison (détail) ── */}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              Bon de livraison{open?.docNum ? ` N° ${open.docNum}` : ""}
              {open?.status === "bost_Close" && <span className="text-[13px] font-normal text-muted-foreground">· clôturé</span>}
            </DialogTitle>
            <DialogDescription className="sr-only">Détail des lignes du bon de livraison SAP sélectionné.</DialogDescription>
          </DialogHeader>

          {open && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13.5px]">
                <span className="text-muted-foreground">Client{" "}
                  {open.cardCode
                    ? <span className="text-foreground font-medium"><ClientLink code={open.cardCode} name={open.cardName} /></span>
                    : <span className="text-foreground font-medium">{open.cardName}</span>}
                </span>
                <span className="text-muted-foreground">Date <span className="text-foreground font-medium tnum">{fmtDateLong(open.docDate)}</span></span>
                {open.numAtCard && <span className="text-muted-foreground">Réf. <span className="text-foreground font-medium">{open.numAtCard}</span></span>}
                {open.colis != null && open.colis > 0 && <span className="text-muted-foreground tnum">{fmtNum(open.colis)} colis</span>}
                {open.weightKg != null && open.weightKg > 0 && <span className="text-muted-foreground tnum">{fmtNum(open.weightKg)} kg</span>}
                {open.invoiceNum && <span className="text-muted-foreground">Facture <span className="text-foreground font-medium tnum">{open.invoiceNum}</span></span>}
              </div>

              {linesErr ? (
                <p className="text-[13px] text-rose-600 dark:text-rose-400 py-2">Détail du bon indisponible pour le moment.</p>
              ) : !lines ? (
                <p className="text-muted-foreground inline-flex items-center gap-2 text-[14px] py-2"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</p>
              ) : (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead className="bg-secondary/40 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2.5 font-semibold">Désignation</th>
                        <th className="text-left px-3 py-2.5 font-semibold w-32">Entrepôt / Lot</th>
                        <th className="text-right px-3 py-2.5 font-semibold w-20">Qté</th>
                        <th className="text-right px-3 py-2.5 font-semibold w-24">PU HT</th>
                        <th className="text-right px-3 py-2.5 font-semibold w-24">Total HT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, k) => (
                        <tr key={k} className="border-t border-border/50">
                          <td className="px-3 py-2">
                            <span className="text-foreground">{l.itemName || l.itemCode}</span>
                            <span className="ml-2 text-[11px] font-mono text-muted-foreground">{l.itemCode}</span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-[12.5px]">{l.warehouse}{l.lot ? ` · ${l.lot}` : ""}</td>
                          <td className="px-3 py-2 text-right tnum">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td>
                          <td className="px-3 py-2 text-right tnum">{fmt2(l.price)} €</td>
                          <td className="px-3 py-2 text-right tnum font-medium">{fmt2(l.lineTotal)} €</td>
                        </tr>
                      ))}
                      {lines.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-3 text-center text-muted-foreground text-[13px]">Aucune ligne.</td></tr>
                      )}
                    </tbody>
                    {(open.total != null || open.totalHT != null) && (
                      <tfoot>
                        {open.totalHT != null && (
                          <tr className="border-t border-border bg-secondary/30">
                            <td colSpan={4} className="px-3 py-2 text-right text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</td>
                            <td className="px-3 py-2 text-right tnum font-semibold text-[15px] text-foreground">{fmt2(open.totalHT)} €</td>
                          </tr>
                        )}
                        {open.total != null && (
                          <tr className="bg-secondary/30 border-t border-border">
                            <td colSpan={4} className="px-3 py-2 text-right text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total TTC</td>
                            <td className="px-3 py-2 text-right tnum font-bold text-[15px] text-foreground">{fmt2(open.total)} €</td>
                          </tr>
                        )}
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SurfaceCard>
  );
}
