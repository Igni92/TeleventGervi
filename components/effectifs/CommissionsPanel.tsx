"use client";

/**
 * COMMISSIONS (onglet Effectifs) — édition de l'ÉTAT PDF.
 *
 * Volontairement SANS tableau à l'écran : cet état sert à être imprimé, signé
 * et transmis (salarié / compta). Le dupliquer en HTML aurait fait deux
 * représentations à maintenir pour le même contenu. L'écran ne garde donc que
 * l'essentiel — reste à payer, déjà payé, dernier versement — et le bouton qui
 * sort le détail mois par mois.
 *
 * Le PDF porte une page par commercial, une ligne par mois (le mois est
 * l'unité de paie) et un TRAIT à la dernière échéance réglée.
 */

import { useEffect, useState } from "react";
import { Wallet, Loader2, Printer, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { printEtatCommissions, type CommissionPdfCommercial } from "@/lib/commissionsPdf";

interface Payload {
  ok: boolean;
  paidThrough: string | null;
  lastPayment: { payslipMonth: string; sentAt: string; sentBy: string; total: number } | null;
  commerciaux: CommissionPdfCommercial[];
  restricted?: boolean;
  message?: string;
}

const eur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const monthLabelFr = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function CommissionsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/effectif/commissions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j: Payload) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const print = () => {
    if (!data?.commerciaux.length) return;
    // Fenêtre bloquée par le navigateur : sans ce message, le clic ne fait
    // visiblement « rien » et l'utilisateur reclique indéfiniment.
    const ok = printEtatCommissions(data.commerciaux, data.paidThrough, new Date());
    if (!ok) toast.error("Impression bloquée par le navigateur — autorisez les fenêtres surgissantes.");
  };

  const totals = data?.commerciaux.reduce(
    (acc, c) => ({ paid: acc.paid + c.totals.paid, due: acc.due + c.totals.due, drift: acc.drift + c.totals.drift }),
    { paid: 0, due: 0, drift: 0 },
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
        <div className="space-y-3">
          {data.commerciaux.length === 0 ? (
            <p className="py-4 text-[13px] text-muted-foreground">
              Aucune commission calculée — aucune facture depuis la date de début de prime.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <Total label="Reste à payer" v={eur2(totals!.due)} tone="brand" />
                <Total label="Déjà payé" v={eur2(totals!.paid)} />
                {Math.abs(totals!.drift) >= 0.01 && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" /> {eur2(totals!.drift)} à régulariser
                  </span>
                )}
                <span className="text-[11.5px] text-muted-foreground">
                  {data.commerciaux.length} commercial{data.commerciaux.length > 1 ? "aux" : ""}
                </span>
              </div>

              <p className="text-[12px] text-muted-foreground max-w-3xl">
                La commission est payée <span className="text-foreground font-medium">tous les mois</span>, sur le
                bulletin. L&apos;état PDF détaille chaque mois, avec un trait à la dernière échéance réglée.
                {data.paidThrough
                  ? <> Payé jusqu&apos;à <span className="text-foreground font-medium">{monthLabelFr(data.paidThrough)}</span>
                      {data.lastPayment && <> — envoyé au cabinet le {dateFr(data.lastPayment.sentAt)} par {data.lastPayment.sentBy}</>}.</>
                  : <> Aucune échéance réglée à ce jour.</>}
              </p>
            </>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}

function Total({ label, v, tone }: { label: string; v: string; tone?: "brand" }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">{label}</span>
      <span className={`text-[16px] font-bold tnum ${tone === "brand" ? "text-brand-400" : "text-foreground"}`}>{v}</span>
    </span>
  );
}
