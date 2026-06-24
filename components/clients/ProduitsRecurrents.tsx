"use client";

import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { SectionCard } from "@/components/clients/SectionCard";
import { formatKg } from "@/components/clients/FamillesVsGroupe";

/**
 * Produits récurrents du client.
 *
 * Lit /api/sap/clients/[id]/recurring : top articles que CE client achète le
 * plus souvent (nb de factures distinctes), classés par fréquence puis volume.
 * Source = historique facturé mirroré (SapInvoice/SapInvoiceLine ⋈ Product).
 *
 * Objectif télévente : repérer en un coup d'œil ce que le client recommande
 * régulièrement pour proposer le réassort. Affichage = table légère :
 * nom article · nb de commandes · dernière commande (+ volume kg en repère).
 */

type Item = {
  itemCode: string;
  itemName: string;
  invoiceCount: number;
  qty: number;
  weightKg: number;
  lastDate: string | null;
};
type Api = { ok: true; items: Item[] } | { ok?: false; error: string };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function ProduitsRecurrents({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sap/clients/${clientId}/recurring`)
      .then((r) => r.json())
      .then((d: Api) => {
        if (cancelled) return;
        if ("ok" in d && d.ok) setItems(d.items);
        else setError(("error" in d && d.error) || "Erreur");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <SectionCard accent="sky" title="Produits récurrents" subtitle="Réassort · historique facturé" icon={<Repeat />}>
      {loading ? (
        <p className="text-sm text-muted-foreground py-2">Chargement…</p>
      ) : error ? (
        <p className="text-sm text-rose-500 py-2">{error}</p>
      ) : !items || items.length === 0 ? (
        <p className="text-[12px] italic text-muted-foreground py-2">
          Aucun historique d&apos;achat exploitable pour ce client.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Articles les plus souvent commandés — classés par fréquence puis volume
            (historique facturé).
          </p>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground border-b border-border">
                <th className="text-left font-medium pb-1.5">Article</th>
                <th className="text-right font-medium pb-1.5 whitespace-nowrap">Cdes</th>
                <th className="text-right font-medium pb-1.5 whitespace-nowrap">Volume</th>
                <th className="text-right font-medium pb-1.5 whitespace-nowrap">Dernière</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.itemCode} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-2 font-medium text-foreground truncate max-w-0 w-full">
                    {it.itemName}
                  </td>
                  <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{it.invoiceCount}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {formatKg(it.weightKg)}
                  </td>
                  <td className="py-1.5 pl-2 text-right text-muted-foreground whitespace-nowrap">
                    {formatDate(it.lastDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </SectionCard>
  );
}
