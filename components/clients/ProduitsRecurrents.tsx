"use client";

import { useEffect, useState } from "react";
import { BarList, type BarItem } from "@/components/charts/BarList";
import { formatKg } from "@/components/clients/FamillesVsGroupe";

/**
 * Produits récurrents du client (C7).
 *
 * Lit /api/sap/clients/[id]/recurring : top articles que CE client achète le
 * plus souvent (nb de factures), classés par fréquence puis volume. Source =
 * historique facturé mirroré (SapInvoice/SapInvoiceLine ⋈ Product).
 *
 * Affichage : BarList valorisée en **kg** (poids exact via salesUnitWeight),
 * sous-libellé = nb de commandes. Pas d'invention d'unité — kg uniquement si
 * le poids produit existe (sinon barre à 0, le hint reste informatif).
 */

type Item = {
  itemCode: string;
  itemName: string;
  invoiceCount: number;
  qty: number;
  weightKg: number;
};
type Api = { ok: true; items: Item[] } | { ok?: false; error: string };

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

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;
  if (!items || items.length === 0) {
    return (
      <p className="text-[12px] italic text-muted-foreground py-2">
        Aucun historique d&apos;achat exploitable pour ce client.
      </p>
    );
  }

  // Valeur de la barre = poids cumulé (kg) ; hint = fréquence (nb de factures).
  const bars: BarItem[] = items.map((it) => ({
    label: it.itemName,
    value: it.weightKg,
    hint: `${it.invoiceCount} cde${it.invoiceCount > 1 ? "s" : ""}`,
  }));

  return (
    <div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Articles les plus achetés — classés par fréquence puis volume (kg cumulé,
        historique facturé).
      </p>
      <BarList items={bars} format={formatKg} max={items.length} />
    </div>
  );
}
