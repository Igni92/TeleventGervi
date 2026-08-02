"use client";

/**
 * COMMISSIONS (onglet Effectifs).
 *
 * Deux volets :
 *   • RELEVÉ DE VERSEMENTS en euros (saisi par la direction) — ce que le patron
 *     a RÉELLEMENT payé à chaque commercial. Par commercial : Dû cumulé / Payé /
 *     Solde (reste à payer, ou trop-payé). But : ne rien perdre ni surpayer.
 *   • ÉTAT PDF détaillé mois par mois (imprimé, signé, transmis au cabinet), avec
 *     un trait à la dernière échéance réglée.
 *
 * Le relevé € est INDÉPENDANT du curseur mensuel « payé jusqu'à … » : il reflète
 * les paiements concrets, à la main, pour un suivi exact du solde.
 */

import { useCallback, useEffect, useState } from "react";
import { Wallet, Loader2, Printer, Plus, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { printEtatCommissions, type CommissionPdfCommercial } from "@/lib/commissionsPdf";

interface Payout { id: string; amount: number; date: string; note: string; by: string; at: string; }
interface Commercial extends CommissionPdfCommercial {
  payouts: Payout[];
  dueCumul: number;
  paidLedger: number;
  solde: number;
}
interface Payload {
  ok: boolean;
  paidThrough: string | null;
  lastPayment: { payslipMonth: string; sentAt: string; sentBy: string; total: number } | null;
  commerciaux: Commercial[];
  canEdit?: boolean;
  restricted?: boolean;
  message?: string;
}

const eur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const dateFrShort = (d: string) => {
  const [y, m, j] = d.split("-");
  return y && m && j ? `${j}/${m}/${y.slice(2)}` : d;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

export function CommissionsPanel({ isManager = false }: { isManager?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/effectif/commissions", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? r.statusText);
      setData(j as Payload);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const print = () => {
    if (!data?.commerciaux.length) return;
    const ok = printEtatCommissions(data.commerciaux, data.paidThrough, new Date());
    if (!ok) toast.error("Impression bloquée par le navigateur — autorisez les fenêtres surgissantes.");
  };

  const canEdit = !!data?.canEdit && isManager;

  const totals = data?.commerciaux.reduce(
    (acc, c) => ({ due: acc.due + c.dueCumul, paid: acc.paid + c.paidLedger, solde: acc.solde + c.solde }),
    { due: 0, paid: 0, solde: 0 },
  );

  return (
    <SurfaceCard
      accent="brand"
      icon={<Wallet className="h-4 w-4" />}
      title="Commissions"
      action={
        <Button size="sm" className="gap-1.5" onClick={print} disabled={!data?.commerciaux.length}>
          <Printer className="h-4 w-4" /> État PDF
        </Button>
      }
    >
      {err && <p className="py-4 text-[13px] text-rose-400">Erreur : {err}</p>}
      {!err && !data && (
        <p className="py-5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calcul mois par mois…
        </p>
      )}

      {data?.restricted && <p className="py-4 text-[13px] text-muted-foreground">{data.message}</p>}

      {data && !data.restricted && (
        data.commerciaux.length === 0 ? (
          <p className="py-4 text-[13px] text-muted-foreground">
            Aucune commission calculée — aucune facture depuis la date de début de prime.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Bandeau total (tous commerciaux). */}
            {totals && (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <Total label="Dû cumulé" v={eur2(totals.due)} />
                <Total label="Payé" v={eur2(totals.paid)} />
                <SoldeChip solde={totals.solde} />
              </div>
            )}

            <p className="text-[12px] text-muted-foreground max-w-3xl">
              Le <span className="text-foreground font-medium">relevé</span> ci-dessous suit ce qui a été
              réellement <span className="text-foreground font-medium">payé en euros</span> à chaque commercial :
              le solde signale ce qu&apos;il reste à verser (ou un trop-payé). L&apos;état PDF garde le détail mois
              par mois pour le cabinet.
            </p>

            <div className="space-y-3">
              {data.commerciaux.map((c) => (
                <CommercialLedger key={c.slp} c={c} canEdit={canEdit} onChanged={reload} />
              ))}
            </div>
          </div>
        )
      )}
    </SurfaceCard>
  );
}

function CommercialLedger({ c, canEdit, onChanged }: { c: Commercial; canEdit: boolean; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const add = async () => {
    const val = Math.round((parseFloat(amount.replace(",", ".")) || 0) * 100) / 100;
    if (!(val > 0)) { toast.error("Montant invalide"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/effectif/commissions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slp: c.slp, amount: val, date, note }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Échec");
      toast.success(`${eur2(val)} enregistré pour ${c.name}`);
      setAmount(""); setNote(""); setDate(todayISO());
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setSaving(false); }
  };

  const remove = async (p: Payout) => {
    if (!window.confirm(`Supprimer le versement de ${eur2(p.amount)} du ${dateFrShort(p.date)} ?`)) return;
    setDeletingId(p.id);
    try {
      const r = await fetch("/api/effectif/commissions", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slp: c.slp, id: p.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Échec");
      toast.success("Versement supprimé");
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); setDeletingId(null); }
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-[13.5px] text-foreground">{c.name}</p>
          <span className="text-[10px] text-muted-foreground tnum">{(c.rate * 100).toFixed(0)} %</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <Total label="Dû" v={eur2(c.dueCumul)} small />
          <Total label="Payé" v={eur2(c.paidLedger)} small />
          <SoldeChip solde={c.solde} small />
        </div>
      </div>

      {/* Relevé des versements. */}
      {c.payouts.length > 0 && (
        <ul className="mt-2 divide-y divide-border/60 border-t border-border/60">
          {c.payouts.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
              <span className="tnum text-muted-foreground w-14 shrink-0">{dateFrShort(p.date)}</span>
              <span className="tnum font-semibold text-foreground w-20 shrink-0">{eur2(p.amount)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={p.note}>{p.note || "—"}</span>
              {canEdit && (
                <button
                  type="button" onClick={() => remove(p)} disabled={deletingId === p.id}
                  title="Supprimer ce versement"
                  className="shrink-0 text-muted-foreground hover:text-rose-500 disabled:opacity-50"
                >
                  {deletingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Ajout d'un versement (direction). */}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <div className="relative">
            <input
              type="text" inputMode="decimal" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="Montant"
              className="h-8 w-28 rounded-md border border-border bg-background pl-2 pr-6 text-[12.5px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">€</span>
          </div>
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-[12.5px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Note (ex. juin + juillet)"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="button" onClick={add} disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-[12.5px] font-semibold text-white hover:bg-brand-700 transition-colors active:scale-[0.97] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Ajouter
          </button>
        </div>
      )}
    </div>
  );
}

function Total({ label, v, small }: { label: string; v: string; small?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">{label}</span>
      <span className={`font-bold tnum text-foreground ${small ? "text-[13px]" : "text-[16px]"}`}>{v}</span>
    </span>
  );
}

function SoldeChip({ solde, small }: { solde: number; small?: boolean }) {
  const size = small ? "text-[13px]" : "text-[16px]";
  if (Math.abs(solde) < 0.01) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">Solde</span>
        <span className={`inline-flex items-center gap-1 font-bold tnum text-emerald-500 ${size}`}>
          <Check className="h-3.5 w-3.5" /> à jour
        </span>
      </span>
    );
  }
  const over = solde < 0; // trop-payé
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">
        {over ? "Trop-payé" : "Reste à payer"}
      </span>
      <span className={`font-bold tnum ${over ? "text-rose-500" : "text-amber-400"} ${size}`}>
        {eur2(Math.abs(solde))}
      </span>
    </span>
  );
}
