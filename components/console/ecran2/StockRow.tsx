"use client";

import { AlertTriangle, Check, Plus, Star } from "lucide-react";
import { unitInfo, personalStock } from "@/lib/gervifrais-calc";
import { freshnessLabel, isDdmSoon } from "@/lib/freshness";
import { BrandLogo } from "@/components/BrandLogo";
import { StarRating } from "@/components/ui/star-rating";
import { DesignationStrong, DesignationMuted } from "@/components/livraisons/ArticleDesignation";
import { cleanTag, colisKg, type Product, type Hint, type DensityUiSpec, type RowMenuTarget } from "./shared";

/**
 * Ligne de la liste stock (colonne gauche de l'écran 2).
 * Clic = ajout/retrait du panier ; clic droit = menu (détails lots · tout mettre) ;
 * étoile = favori. Rendu inchangé — extrait tel quel de Ecran2Order.
 */
export function StockRow({
  p, hint: h, ui, stockSharePct, brandLogos, note, isFav, tarifPrice, inCart, hasClosedLine,
  onToggleCart, onToggleFavorite, setMenuTarget, openRowMenu,
}: {
  p: Product;
  hint: Hint | undefined;
  ui: DensityUiSpec;
  stockSharePct: number;
  brandLogos: Map<string, string>;
  note: number | undefined;
  isFav: boolean;
  tarifPrice: number | undefined;
  inCart: boolean;
  hasClosedLine: boolean;
  onToggleCart: () => void;
  onToggleFavorite: () => void;
  setMenuTarget: (t: RowMenuTarget) => void;
  openRowMenu: (e: React.MouseEvent) => void;
}) {
  const { packDivisor, displayUnit: unit, priceUnit, isKg } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
  const total = ["R1", "01", "000"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0) / packDivisor;
  const perso = personalStock(total, stockSharePct);
  const noStock = total <= 0;
  const dispo = stockSharePct < 100 ? perso : total;
  // Désignation article partagée (ArticleDesignation) : marque + calibre en
  // BLANC (ligne 1, collés au nom du fruit), conditionnement · variété · pays
  // effacés (ligne 2). Fin du mur de pseudo-boutons colorés par ligne.
  // Calibre = U_GER_CALIBRE (via Hint, chargé après) — distinct du condi.
  const marque = cleanTag(p.uMarque ?? h?.marque);
  const desig = {
    marque,
    condt: p.uCondi ?? p.uUvc,   // ex. 8×500g
    calibre: h?.calibre,         // « cal. » ajouté par DesignationStrong
    variete: p.frgnName,         // variété (FrgnName)
    pays: p.uPays ?? h?.pays,
  };
  // Alerte fraîcheur : DDM la plus proche encore à venir sur cet
  // article (API produits). Affichée UNIQUEMENT si elle est proche
  // (≤ 3 j) — sinon ce serait du bruit sur tout le catalogue.
  const dlcWarn = isDdmSoon(p.dlc) ? freshnessLabel(p.dlc ? new Date(p.dlc) : null) : null;
  // C2 — plus de badge promo sur la liste stock : la remise
  // auto au panier reste (cf. addToCart), le récap vit dans
  // le Dialog « Promotions » et sur la ligne panier.
  const kgC     = !isKg ? colisKg(p) : null;          // B4
  // Chips dimensionnés par la densité (C4)
  const chipCls = `inline-flex items-center px-2 rounded-[5px] font-semibold ${ui.chip}`;
  const toggleCart = () => {
    if (inCart) { if (hasClosedLine) return; }
    onToggleCart();
  };
  return (
    <li>
      {/* Ligne = div role=button (et non <button>) : l'étoile favoris
          est un vrai bouton imbriqué — interdit dans un <button>. */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleCart}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCart(); }
        }}
        onContextMenu={(e) => {
          const fullQty = dispo > 0 ? (packDivisor > 1 ? Math.floor(dispo) : Math.round(dispo * 10) / 10) : 0;
          setMenuTarget({ p, fullQty, dispo: Math.round(dispo * 10) / 10, unit, packDivisor });
          openRowMenu(e);
        }}
        title={inCart ? "Retirer du panier"
                      : noStock ? "À découvert — sera créé en EM_PENDING, lot affecté à réception"
                      : "Ajouter au panier"}
        className={`w-full grid items-center gap-3 px-2.5 ${ui.rowPad} text-left cursor-pointer select-none transition-colors ${
          inCart ? "bg-emerald-50 dark:bg-emerald-950/30 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            : noStock ? "bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-100/60 dark:hover:bg-rose-950/30"
            : "hover:bg-secondary/40"}`}
        style={{ gridTemplateColumns: "28px 96px minmax(0,1fr) 118px 30px" }}
      >
        {/* Col 1 — Add/Done */}
        <span className={`h-7 w-7 inline-flex items-center justify-center rounded-md shrink-0 ${inCart ? "bg-emerald-500 text-white" : "bg-brand-500/10 text-brand-600 dark:text-brand-400"}`}>
          {inCart ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </span>
        {/* Col 2 — Dispo (quantité à gauche, bien lisible) */}
        <span className="flex flex-col leading-none">
          {noStock ? (
            <>
              <span className={`${ui.dec} font-bold text-rose-600 dark:text-rose-400`}>À déc.</span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-rose-500/80 mt-1">à récept.</span>
            </>
          ) : (
            <>
              <span className={`${ui.dispo} font-bold tnum tracking-tight text-foreground`}>
                {packDivisor > 1 ? Math.floor(dispo) : dispo.toFixed(0)}
              </span>
              <span className={`${ui.dispoUnit} font-medium uppercase tracking-wide text-muted-foreground/70 mt-1`}>
                {unit}
              </span>
            </>
          )}
        </span>
        {/* Col 3 — Produit COMPACT (2 lignes) : ligne 1 = nom + marque + calibre
            (blanc), ligne 2 = conditionnement · variété · pays (effacé) + alerte
            DDM + colis/kg. Désignation partagée (ArticleDesignation) : plus de
            mur de pseudo-boutons colorés — la couleur ne signale QUE l'état. */}
        <span className="min-w-0 flex items-center gap-2">
          <BrandLogo marque={marque} logos={brandLogos} size="xl" />
          <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className={`${ui.name} font-semibold text-foreground truncate leading-tight shrink`}>
              {p.itemName}
            </span>
            {/* Marque + calibre en blanc, collés au nom du fruit. */}
            <DesignationStrong l={desig} className={`${ui.name} shrink-0 leading-tight`} />
            {/* Note qualité (étoiles) saisie à la réception. */}
            {note ? <StarRating value={note} size="sm" className="shrink-0 self-center" /> : null}
          </span>
          {/* Ligne 2 : alerte DDM (seule couleur d'état) + désignation effacée
              + colis/kg. Le CODE ARTICLE n'apparaît plus (clic droit « Détails »). */}
          <span className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap min-w-0">
            {/* DDM PROCHE — en TÊTE : c'est l'info qui doit arrêter l'œil du
                vendeur avant qu'il n'engage la vente. */}
            {dlcWarn && (
              <span
                title={`Marchandise en stock dont la date limite est proche (${dlcWarn.label})`}
                className={`${chipCls} shrink-0 inline-flex items-center gap-1 ${
                  dlcWarn.tone === "red"
                    ? "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-400/60 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/50"
                    : "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-400/60 dark:bg-amber-500/30 dark:text-amber-50 dark:ring-amber-400/50"
                }`}
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {dlcWarn.label}
              </span>
            )}
            <DesignationMuted l={desig} className={`${ui.code} min-w-0`} />
            {/* B4 — poids du colis quand calculable (≈ poids unité × pièces/colis) */}
            {kgC != null && (
              <span className={`${ui.code} text-muted-foreground/80 font-medium shrink-0`}>
                {kgC % 1 === 0 ? kgC.toFixed(0) : String(kgC)} kg/colis
              </span>
            )}
          </span>
          </span>
        </span>
        {/* Col 4 — Prix : cotation TARIF client prioritaire, sinon conseillé */}
        <span className="text-right tnum">
          {(() => {
            if (tarifPrice != null) {
              return (
                <>
                  <span className={`block ${ui.price} font-bold leading-tight text-violet-600 dark:text-violet-400`}>
                    {tarifPrice.toFixed(2)} €
                  </span>
                  <span className={`block ${ui.priceUnit} font-semibold text-violet-500/80 leading-tight`}>
                    tarif /{priceUnit}
                  </span>
                </>
              );
            }
            return h?.prixConseille != null ? (
              <>
                <span className={`block ${ui.price} font-bold leading-tight ${h.isDefault ? "text-foreground/70" : "text-brand-600 dark:text-brand-400"}`}>
                  {h.prixConseille.toFixed(2)} €
                </span>
                <span className={`block ${ui.priceUnit} font-normal text-muted-foreground leading-tight`}>
                  /{priceUnit}
                </span>
              </>
            ) : <span className="block text-[13px] text-muted-foreground/40">—</span>;
          })()}
        </span>
        {/* Col 5 — C1 : étoile favoris (zone cliquable séparée, stopPropagation) */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-pressed={isFav}
          title={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
          className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors ${
            isFav ? "text-amber-400 hover:text-amber-300"
                  : "text-muted-foreground/40 hover:text-amber-400 hover:bg-secondary/60"
          }`}
        >
          <Star className="h-4 w-4" fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>
    </li>
  );
}
