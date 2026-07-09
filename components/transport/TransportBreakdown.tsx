"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, BarChart3, Truck, Users, PieChart, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COST_KIND_LABELS, TRANSPORT_COST_KINDS, type TransportCostMetrics } from "@/lib/transportCost";

/**
 * États DÉTAILLÉS des coûts de livraison :
 *   • par POSTE de coût (ventilation du modèle — client-side) ;
 *   • par TRANSPORTEUR et par CLIENT (analyse SAP sur 12 mois glissants, à la
 *     demande via /api/transport/breakdown).
 */

const fmtEur = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmtEur2 = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtPerKg = (v: number) => `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v)} €/kg`;
const fmtKg = (v: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} kg`;
const fmtInt = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
const fmtPct = (v: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v)} %`;

interface CarrierRow { code: string; deliveries: number; kg: number; cost: number; perKg: number; direct: boolean }
interface ClientRow { cardCode: string; name: string; deliveries: number; kg: number; cost: number; directKg: number; extKg: number; perKg: number }
interface BreakdownResp {
  ok: boolean;
  window: string;
  prixPositionPerKg: number;
  totals: { deliveries: number; kg: number; cost: number };
  carriers: CarrierRow[];
  clients: ClientRow[];
  truncated: boolean;
  error?: string;
}

export function TransportBreakdown({ metrics, isManager }: { metrics: TransportCostMetrics; isManager: boolean }) {
  const [data, setData] = useState<BreakdownResp | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/transport/breakdown", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de l'analyse");
      setData(j);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  // Ventilation par poste (client-side depuis le modèle).
  const posteRows = TRANSPORT_COST_KINDS
    .map((k) => ({ kind: k, annual: metrics.byKind[k] ?? 0 }))
    .filter((r) => r.annual > 0)
    .sort((a, b) => b.annual - a.annual);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> États détaillés · coûts de livraison
          </p>
          <p className="text-[12px] text-muted-foreground mt-1 max-w-xl">
            Ventilation du coût par poste, et — à la demande — analyse des BL des 12 derniers mois
            par transporteur et par client (coût transport appliqué : direct = prix position,
            externe = tarif du client).
          </p>
        </div>
        {isManager && (
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            {data ? "Rafraîchir" : "Analyser les BL"}
          </Button>
        )}
      </div>

      {/* ── Ventilation par POSTE (modèle) ── */}
      <div>
        <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 inline-flex items-center gap-1">
          <PieChart className="h-3 w-3" /> Par poste de coût (annuel)
        </p>
        {posteRows.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Aucun coût saisi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] tnum">
              <thead>
                <tr className="text-muted-foreground border-b border-border/60">
                  <th className="text-left font-medium py-1.5 pr-3">Poste</th>
                  <th className="text-right font-medium py-1.5 px-3">€/an</th>
                  <th className="text-right font-medium py-1.5 px-3">Part</th>
                  <th className="text-right font-medium py-1.5 pl-3">€/kg</th>
                </tr>
              </thead>
              <tbody>
                {posteRows.map((r) => (
                  <tr key={r.kind} className="border-b border-border/40 last:border-0 text-foreground/90">
                    <td className="py-1.5 pr-3">{COST_KIND_LABELS[r.kind]}</td>
                    <td className="py-1.5 px-3 text-right">{fmtEur(r.annual)}</td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">{metrics.annualCost > 0 ? fmtPct((r.annual / metrics.annualCost) * 100) : "—"}</td>
                    <td className="py-1.5 pl-3 text-right">{metrics.kgPerYear > 0 ? fmtPerKg(r.annual / metrics.kgPerYear) : "—"}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-foreground border-t border-border/60">
                  <td className="py-1.5 pr-3">Total</td>
                  <td className="py-1.5 px-3 text-right">{fmtEur(metrics.annualCost)}</td>
                  <td className="py-1.5 px-3 text-right">100 %</td>
                  <td className="py-1.5 pl-3 text-right">{metrics.kgPerYear > 0 ? fmtPerKg(metrics.prixPositionPerKg) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Analyse SAP (par transporteur + par client) ── */}
      {data && (
        <>
          {/* Totaux */}
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat label="Livraisons (12 mois)" value={fmtInt(data.totals.deliveries)} />
            <MiniStat label="Poids livré" value={fmtKg(data.totals.kg)} />
            <MiniStat label="Coût transport imputé" value={fmtEur(data.totals.cost)} tone="amber" />
          </div>
          {data.truncated && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Résultat plafonné (beaucoup de BL) — chiffres partiels.
            </p>
          )}

          {/* Par transporteur */}
          <div>
            <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 inline-flex items-center gap-1">
              <Truck className="h-3 w-3" /> Par transporteur
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] tnum">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/60">
                    <th className="text-left font-medium py-1.5 pr-3">Transporteur</th>
                    <th className="text-right font-medium py-1.5 px-3">Livr.</th>
                    <th className="text-right font-medium py-1.5 px-3">Poids</th>
                    <th className="text-right font-medium py-1.5 px-3">€/kg</th>
                    <th className="text-right font-medium py-1.5 pl-3">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {data.carriers.map((c) => (
                    <tr key={c.code} className="border-b border-border/40 last:border-0 text-foreground/90">
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          {c.code}
                          {c.direct && <span className="text-[9px] uppercase tracking-wide font-bold text-brand-600 dark:text-brand-400">direct</span>}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right">{fmtInt(c.deliveries)}</td>
                      <td className="py-1.5 px-3 text-right">{fmtKg(c.kg)}</td>
                      <td className="py-1.5 px-3 text-right text-muted-foreground">{c.perKg > 0 ? fmtPerKg(c.perKg) : "—"}</td>
                      <td className="py-1.5 pl-3 text-right font-medium">{fmtEur2(c.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Par client (top 100) */}
          <div>
            <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> Par client · top {data.clients.length} (coût décroissant)
            </p>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-lg border border-border/50">
              <table className="w-full text-[12.5px] tnum">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-muted-foreground border-b border-border/60">
                    <th className="text-left font-medium py-1.5 px-3">Client</th>
                    <th className="text-right font-medium py-1.5 px-3">Livr.</th>
                    <th className="text-right font-medium py-1.5 px-3">Poids</th>
                    <th className="text-right font-medium py-1.5 px-3">€/kg</th>
                    <th className="text-right font-medium py-1.5 px-3">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr key={c.cardCode} className="border-b border-border/40 last:border-0 text-foreground/90">
                      <td className="py-1.5 px-3 max-w-[220px] truncate" title={`${c.name} · ${c.cardCode}`}>{c.name}</td>
                      <td className="py-1.5 px-3 text-right">{fmtInt(c.deliveries)}</td>
                      <td className="py-1.5 px-3 text-right">{fmtKg(c.kg)}</td>
                      <td className="py-1.5 px-3 text-right text-muted-foreground">{c.perKg > 0 ? fmtPerKg(c.perKg) : "—"}</td>
                      <td className="py-1.5 px-3 text-right font-medium">{fmtEur2(c.cost)}</td>
                    </tr>
                  ))}
                  {data.clients.length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Aucune livraison sur la période.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "amber" }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${tone === "amber" ? "bg-amber-50 dark:bg-amber-950/30 ring-1 ring-inset ring-amber-300/40 dark:ring-amber-500/30" : "bg-secondary/40"}`}>
      <p className={`text-[18px] font-bold tnum leading-tight ${tone === "amber" ? "text-amber-700 dark:text-amber-300" : "text-foreground"}`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
