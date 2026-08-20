"use client";

import { toast } from "sonner";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { unitInfo } from "@/lib/gervifrais-calc";
import { TarifFruitsEditor } from "@/components/clients/TarifFruitsEditor";
import { NumberInput } from "@/components/ui/number-input";
import type { CartLine, Product, TarifItem } from "./shared";

/**
 * Onglet TARIF de la colonne gauche : tarif PAR FRUITS (désignation) +
 * cotations PAR ARTICLE (SKU) spécifiques du client, prioritaires sur le prix
 * conseillé à l'ajout au panier. Rendu inchangé — extrait tel quel de Ecran2Order.
 */
export function TarifTab({
  clientId, tarifQuery, setTarifQuery, addTarif, tarifAdding, filterQ,
  tarifs, productByCode, cart, mutateTarifs, onAddToCart,
}: {
  clientId: string;
  tarifQuery: string;
  setTarifQuery: (v: string) => void;
  addTarif: () => void;
  tarifAdding: boolean;
  filterQ: string;
  tarifs: TarifItem[] | null;
  productByCode: Map<string, Product>;
  cart: CartLine[];
  mutateTarifs: (fn: (cur: TarifItem[]) => TarifItem[]) => void;
  onAddToCart: (p: Product, opts?: { quantity?: number; price?: number | null; noPromo?: boolean }) => void;
}) {
  const q = filterQ;
  return (
    /* ── Onglet TARIF — par fruits (désignation) + par article (cotation SKU) ── */
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Tarif PAR FRUITS (famille · origine · calibre · variété) — édité ici ET
          dans la fiche client ; appliqué en priorité sur le prix conseillé. */}
      <div className="shrink-0 mb-3 pb-3 border-b border-border max-h-[46%] overflow-y-auto pr-1">
        <p className="mb-2 text-[12px] font-semibold text-foreground">Tarif par fruits</p>
        <TarifFruitsEditor clientId={clientId} compact />
      </div>
      <p className="shrink-0 mb-2 text-[12px] font-semibold text-foreground">Tarif par article (SKU)</p>
      <div className="shrink-0 mb-2 flex items-center gap-1.5">
        <input
          value={tarifQuery}
          onChange={(e) => setTarifQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTarif(); } }}
          placeholder="Ajouter un article au tarif (code ou nom)…"
          className="flex-1 h-9 rounded-md border border-border bg-background text-[13.5px] px-2.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          type="button" onClick={addTarif} disabled={tarifAdding || !tarifQuery.trim()}
          className="inline-flex items-center gap-1 h-9 px-3 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-semibold disabled:opacity-50"
        >
          {tarifAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter
        </button>
      </div>
      <p className="shrink-0 mb-2 text-[11px] text-muted-foreground">
        Cotations spécifiques de ce client : le prix négocié est <b>prioritaire</b> sur le prix
        conseillé à l&apos;ajout au panier (sauvegarde automatique).
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {tarifs === null ? (
          <p className="py-4 text-[13px] text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement du tarif…
          </p>
        ) : tarifs.length === 0 ? (
          <p className="py-4 text-[13px] text-muted-foreground italic text-center">
            Aucune cotation pour ce client — ajoute un article ci-dessus.
          </p>
        ) : (
          <ul className="divide-y divide-border/40 border border-border rounded-lg overflow-hidden">
            {tarifs
              .filter((t) => {
                if (!q) return true;
                const p = productByCode.get(t.itemCode);
                return (t.itemCode + (p?.itemName ?? "")).toLowerCase().includes(q);
              })
              .map((t) => {
                const p = productByCode.get(t.itemCode);
                const inCart = cart.some((l) => l.itemCode === t.itemCode);
                const { priceUnit } = unitInfo(p?.salesUnit ?? null, p?.salesQtyPerPackUnit ?? null);
                return (
                  <li key={t.itemCode} className="flex items-center gap-2 px-2.5 py-1.5">
                    {/* Ajout direct au panier AU PRIX DU TARIF */}
                    <button
                      type="button"
                      disabled={!p || inCart}
                      onClick={() => { if (p) { onAddToCart(p, { price: t.price, noPromo: true }); toast.success(`${p.itemName} ajouté au panier — tarif ${t.price.toFixed(2)} €`); } }}
                      title={!p ? "Article hors catalogue chargé (active « + Rupture » sur l'onglet Stock)"
                        : inCart ? "Déjà au panier" : "Ajouter au panier au prix du tarif"}
                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md shrink-0 disabled:opacity-40 ${
                        inCart ? "bg-emerald-500 text-white" : "bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"
                      }`}
                    >
                      {inCart ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-foreground truncate leading-tight">
                        {p?.itemName ?? t.itemCode}
                      </span>
                      <span className="block font-mono text-[10.5px] text-muted-foreground/60 truncate">{t.itemCode}</span>
                    </span>
                    <NumberInput
                      value={t.price}
                      onValueChange={(n) => mutateTarifs((cur) => cur.map((x) => x.itemCode === t.itemCode ? { ...x, price: n ?? 0 } : x))}
                      min={0} step={0.1} decimals={2}
                      aria-label={`Prix tarif ${p?.itemName ?? t.itemCode}`}
                      className="h-9 w-[88px] text-right text-[14.5px] font-semibold tnum rounded-md border border-violet-300/70 dark:border-violet-500/40 bg-background px-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500"
                    />
                    <span className="text-[11px] text-muted-foreground w-8 shrink-0">€/{priceUnit}</span>
                    <button
                      type="button"
                      onClick={() => mutateTarifs((cur) => cur.filter((x) => x.itemCode !== t.itemCode))}
                      title="Retirer cet article du tarif"
                      className="shrink-0 text-muted-foreground/50 hover:text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}
