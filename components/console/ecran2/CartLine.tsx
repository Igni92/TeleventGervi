"use client";

import { toast } from "sonner";
import { ChevronDown, ChevronUp, Gift, Lock, Megaphone, MoreHorizontal, ShieldAlert, Trash2, X } from "lucide-react";
import type { SafeguardViolation } from "@/lib/safeguards";
import { totalAvailable } from "@/lib/gervifrais-calc";
import { InfoHint } from "@/components/ui/info-hint";
import { NumberInput } from "@/components/ui/number-input";
import { DesignationStrong, DesignationMuted } from "@/components/livraisons/ArticleDesignation";
import { ConsoleLotPicker, type ConsoleLotCandidate } from "../ConsoleLotPicker";
import { lineHT, promoBadge, type CartLine, type Hint, type Promo } from "./shared";

/**
 * Interstice de dépôt entre deux lignes du BL (glisser-déposer) — rectangle en
 * pointillé qui apparaît pendant un glisser et « s'allume » au survol. Déposer
 * ICI = INSÉRER la ligne à cette position (déposer SUR une ligne = échange).
 */
export function CartDropGap({
  show, highlighted, onOver, onDrop,
}: {
  show: boolean;
  highlighted: boolean;
  onOver: () => void;
  onDrop: () => void;
}) {
  if (!show) return null;
  return (
    <div
      aria-hidden
      onDragOver={(e) => { e.preventDefault(); onOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={`rounded-lg border border-dashed transition-all duration-150 ${
        highlighted ? "h-11 border-brand-500 bg-brand-500/10" : "h-1.5 border-border"
      }`}
    />
  );
}

/**
 * Tuile d'une ligne du panier (colonne « Commande »).
 * Saisie AU COLIS (steppers ± + champ), prix, promo par ligne, réordonnancement
 * (glisser + flèches), lot pour bon de commande. Rendu inchangé — extrait tel
 * quel de Ecran2Order.
 */
export function CartLineTile({
  l, i, cartLength, hint, activePromo, lineSafeguards, isBonCommande, lotCand,
  confirmedBigQty, dragLine, overLine, selected,
  updateLine, moveLine, removeLine, togglePromo, onSelect,
  setDragLine, endLineDrag, setLineMenu, setOverLine, swapLine,
}: {
  l: CartLine;
  i: number;
  cartLength: number;
  hint: Hint | undefined;
  activePromo: Promo | undefined;
  lineSafeguards: SafeguardViolation[];
  isBonCommande: boolean;
  lotCand: { candidates: ConsoleLotCandidate[]; suggested: string | null } | undefined;
  confirmedBigQty: Set<string>;
  dragLine: number | null;
  overLine: string | null;
  selected: boolean;
  updateLine: (i: number, patch: Partial<CartLine>) => void;
  moveLine: (i: number, dir: -1 | 1) => void;
  removeLine: (i: number) => void;
  togglePromo: (i: number) => void;
  onSelect: (i: number) => void;
  setDragLine: (n: number | null) => void;
  endLineDrag: () => void;
  setLineMenu: (m: { x: number; y: number; index: number } | null) => void;
  setOverLine: (s: string | null) => void;
  swapLine: (a: number, b: number) => void;
}) {
  const max = totalAvailable(l.availByWarehouse);
  const over = l.quantity > max;
  const sellShort = max <= 0;             // entièrement à découvert
  const partialShort = over && !sellShort;
  const locked = !!l.originalLine?.closed; // ligne déjà livrée → verrouillée
  // Saisie AU COLIS : le panier stocke `quantity` (en unité de base via
  // packDivisor — kg/pie) ; on SAISIT en colis et on AFFICHE la conversion
  // en unité de base. `baseUnitsPerColis` = stepColis × packDivisor (ex.
  // 4 kg, 12 pie). Article sans colis réel (=1) → saisie en unité de base.
  const baseUnitsPerColis = Math.round(l.stepColis * l.packDivisor * 1000) / 1000;
  const hasColis = baseUnitsPerColis > 1;
  const baseQty = Math.round(l.quantity * l.packDivisor * 100) / 100;
  const colisCount = hasColis ? Math.round((l.quantity / l.stepColis) * 100) / 100 : baseQty;
  const freeColis = hasColis
    ? Math.round((l.freeUnits / l.stepColis) * 100) / 100
    : Math.round(l.freeUnits * l.packDivisor * 100) / 100;
  // #12 — Plafond SOUPLE anti-saisie aberrante, exprimé dans l'unité
  // AFFICHÉE du champ (colis si hasColis, sinon unité de base). On
  // confirme au-delà de 200 colis OU de 50× le stock dispo connu (>0).
  // `max` est en unité de base / packDivisor ; on le convertit dans
  // l'unité du champ pour comparer des grandeurs homogènes.
  const SOFT_CAP_COLIS = 200;
  const availInField = hasColis
    ? (max * l.packDivisor) / l.stepColis   // base/packDiv → colis
    : max * l.packDivisor;                  // base/packDiv → unité de base
  const absoluteCap = hasColis ? SOFT_CAP_COLIS : SOFT_CAP_COLIS * baseUnitsPerColis;
  const relativeCap = availInField > 0 ? availInField * 50 : Infinity;
  const lineSoftMax = Math.min(absoluteCap, relativeCap);
  const fieldUnitLabel = hasColis ? "colis" : l.priceUnit;
  // Garde anti-aberration : confirme une grosse saisie (sans bloquer).
  const guardBigQty = (typed: number) => {
    if (confirmedBigQty.has(l.itemCode)) return;   // déjà confirmé pour cette ligne
    const rounded = Math.round(typed * 100) / 100;
    const cap = Math.round(lineSoftMax * 100) / 100;
    toast.warning(`Confirmer ${rounded} ${fieldUnitLabel} pour ${l.itemName} ?`, {
      description: "Quantité inhabituellement élevée — vérifie qu'il n'y a pas d'erreur de saisie.",
      duration: 12000,
      action: {
        label: "Oui, c'est correct",
        onClick: () => { confirmedBigQty.add(l.itemCode); },
      },
      cancel: {
        label: "Corriger",
        onClick: () => {
          // Revient au plafond souple (dans l'unité de base stockée).
          const backBase = hasColis ? cap * l.stepColis : cap / l.packDivisor;
          updateLine(i, { quantity: Math.round(backBase * 1000) / 1000 });
        },
      },
    });
  };
  // Désignation partagée (ArticleDesignation) : marque + calibre en blanc
  // (ligne 1, après le nom), conditionnement · variété · pays effacés (ligne 2).
  const desig = {
    marque: l.marque,
    condt: l.condi,
    calibre: hint?.calibre,   // « cal. » ajouté par DesignationStrong
    variete: l.variete,
    pays: l.pays,
  };
  return (
    <div
      draggable={!locked}
      onClick={(e) => {
        // Clic simple sur la tuile = sélection/édition (le clic sur un champ,
        // un stepper ou un bouton garde son comportement propre).
        if ((e.target as HTMLElement).closest("input, select, textarea, button, a")) return;
        onSelect(i);
      }}
      onDragStart={(e) => {
        // Toute la tuile est saisissable — SAUF les champs/boutons, qui
        // gardent leur comportement natif (focus, sélection, clic).
        const el = e.target as HTMLElement;
        if (locked || el.closest("input, select, textarea, button, a")) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        setDragLine(i);
      }}
      onDragEnd={endLineDrag}
      onContextMenu={(e) => {
        // Clic droit = MENU de ligne : 2ᵉ ligne du même article / remplacer.
        const el = e.target as HTMLElement;
        if (el.closest("input, select, textarea")) return;   // menu natif dans les champs
        e.preventDefault();
        if (locked) return;
        setLineMenu({ x: e.clientX, y: e.clientY, index: i });
      }}
      onDragOver={(e) => { if (dragLine !== null && dragLine !== i) { e.preventDefault(); setOverLine(`row:${i}`); } }}
      onDrop={(e) => { if (dragLine !== null && dragLine !== i) { e.preventDefault(); swapLine(dragLine, i); } endLineDrag(); }}
      aria-selected={selected}
      title="Cliquer pour sélectionner · glisser pour réordonner · « ⋯ » ou clic droit : dupliquer, remplacer"
      className={`rounded-lg border p-2 transition-all duration-150 ${!locked ? "cursor-grab active:cursor-grabbing" : ""} ${
        dragLine === i ? "opacity-40" : ""
      } ${
        overLine === `row:${i}`
          ? "ring-2 ring-brand-500 ring-offset-1 ring-offset-background"
          : selected ? "ring-2 ring-brand-500/60" : ""
      } ${sellShort
        ? "border-rose-400/60 bg-rose-50/40 dark:bg-rose-950/15"
        : selected ? "border-brand-500/60 bg-brand-500/5" : "border-border"}`}
    >
    <div className="flex items-start justify-between gap-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-x-1.5 gap-y-1 flex-wrap">
          <p className="text-callout font-medium text-foreground shrink-0">{l.itemName}</p>
          {/* Marque + calibre en blanc, collés au nom (désignation partagée). */}
          <DesignationStrong l={desig} className="text-callout shrink-0" />
          {sellShort && (
            <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              À DÉCOUVERT
            </span>
          )}
          {/* C2 — promo PAR LIGNE, jamais imposée : appliquer/retirer en 1 clic
              (badge actif = clic pour retirer ; sinon chip discret si une promo
              existe pour l'article). Marche aussi sur les lignes déjà au BL. */}
          {l.promo ? (
            <button type="button" onClick={() => togglePromo(i)} title="Retirer la promotion"
              className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/60 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/50 hover:bg-rose-200 dark:hover:bg-rose-500/40">
              {promoBadge(l.promo)} <X className="h-2.5 w-2.5" />
            </button>
          ) : (activePromo && !locked) ? (
            <button type="button" onClick={() => togglePromo(i)} title="Appliquer la promotion"
              className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-[11px] font-semibold border border-dashed border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-950/30">
              <Megaphone className="h-2.5 w-2.5" /> {promoBadge(activePromo)}
            </button>
          ) : null}
          {/* Modification : ligne déjà LIVRÉE → verrouillée (ni édition ni retrait) */}
          {locked && (
            <>
              <span
                className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-[11px] font-bold bg-muted text-muted-foreground">
                <Lock className="h-3 w-3" /> livré
              </span>
              <InfoHint label="Ligne livrée" size={14}>
                Ligne déjà livrée — verrouillée
              </InfoHint>
            </>
          )}
        </div>
        {/* Ligne 2 : conditionnement · variété · pays, effacés (code masqué).
            Plus de pseudo-boutons colorés — la couleur ne signale que l'état. */}
        <DesignationMuted l={desig} className="text-caption mt-0.5" />
      </div>
      {/* Actions de ligne : réordonner (flèches ; la tuile entière est
          glissable) + supprimer (sauf ligne livrée). L'ordre du panier =
          l'ordre des lignes du BL, à la création comme en modification. */}
      <div className="flex items-center gap-0.5 shrink-0">
        <div className="flex flex-col -my-0.5">
          <button type="button" tabIndex={-1} onClick={() => moveLine(i, -1)} disabled={i === 0}
            aria-label="Monter la ligne" title="Monter"
            className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 leading-none">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" tabIndex={-1} onClick={() => moveLine(i, 1)} disabled={i === cartLength - 1}
            aria-label="Descendre la ligne" title="Descendre"
            className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 leading-none">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Menu « ⋯ » VISIBLE (tablettes) : mêmes actions que le clic droit
            (dupliquer / remplacer). Ancré sous le bouton. */}
        {!locked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setLineMenu({ x: r.right, y: r.bottom, index: i });
            }}
            aria-label="Plus d'actions"
            title="Dupliquer, remplacer l'article…"
            className="text-muted-foreground/50 hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
        {!locked && (
          <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground/50 hover:text-rose-500">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
    <div className={`flex items-center gap-1.5 mt-1.5 ${locked ? "opacity-60" : ""}`}>
      {/* On SAISIT au colis (−/+ avancent d'un colis) et on AFFICHE la
          conversion en unité de base : « 9 colis (36 kg) × 7.20 ».
          Article sans colis réel → saisie directe en unité de base. */}
      <div className="inline-flex items-center rounded-lg border border-border overflow-hidden shrink-0">
        <button
          type="button" tabIndex={-1} disabled={locked}
          onClick={() => updateLine(i, { quantity: Math.max(0, Math.round((l.quantity - l.stepColis) * 1000) / 1000) })}
          aria-label="Retirer un colis"
          className="h-11 w-9 inline-flex items-center justify-center text-[18px] font-bold text-muted-foreground hover:bg-secondary/60 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
        >−</button>
        <NumberInput value={hasColis ? colisCount : baseQty}
          onValueChange={(n) => updateLine(i, { quantity: hasColis ? Math.round((n ?? 0) * l.stepColis * 1000) / 1000 : (n ?? 0) / l.packDivisor })}
          min={0} step={hasColis ? 1 : baseUnitsPerColis} disabled={locked}
          softMax={lineSoftMax} onSoftMaxExceeded={guardBigQty}
          aria-label={`Quantité ${l.itemName} (en ${hasColis ? "colis" : l.priceUnit})`}
          className={`h-11 w-[64px] text-center text-[17px] font-semibold tnum border-x border-border bg-background px-1 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${over ? "text-amber-600 dark:text-amber-400" : ""}`} />
        <button
          type="button" tabIndex={-1} disabled={locked}
          onClick={() => updateLine(i, { quantity: Math.round((l.quantity + l.stepColis) * 1000) / 1000 })}
          aria-label="Ajouter un colis"
          className="h-11 w-9 inline-flex items-center justify-center text-[18px] font-bold text-brand-600 dark:text-brand-400 hover:bg-secondary/60 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
        >+</button>
      </div>
      {hasColis ? (
        <span className="text-[12px] text-muted-foreground whitespace-nowrap">
          colis <span className="text-[13.5px] font-semibold text-foreground tnum">({baseQty}&nbsp;{l.priceUnit})</span>
        </span>
      ) : (
        <span className="text-[12px] text-muted-foreground w-9">{l.priceUnit}</span>
      )}
      <span className="text-muted-foreground">×</span>
      <NumberInput value={l.price} onValueChange={(n) => updateLine(i, { price: n })}
        min={0} step={0.1} decimals={2} allowEmpty placeholder="prix" disabled={locked}
        aria-label={`Prix ${l.itemName}`}
        className="h-11 w-[84px] text-right text-[17px] font-semibold tnum rounded-lg border border-border bg-background px-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500" />
      <span className="text-[12px] text-muted-foreground">€/{l.priceUnit}</span>
      <span className="ml-auto text-[15px] font-bold tnum">{l.price ? lineHT(l).toFixed(2) : "—"}</span>
    </div>
    {/* Colis OFFERTS — lecture seule : non modifiable directement (piloté par
        les promotions ; X+Y les ajoute EN PLUS, FREE les prend SUR la qté saisie). */}
    {l.freeUnits > 0 && (
      <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">
        <Gift className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">
          {freeColis} {hasColis ? "colis" : l.priceUnit} offert{freeColis > 1 ? "s" : ""}
        </span>
        {hasColis && (
          <span className="text-foreground/50 tnum">({Math.round(l.freeUnits * l.packDivisor * 100) / 100} {l.priceUnit})</span>
        )}
        <span className="text-muted-foreground">· promo</span>
      </div>
    )}
    {sellShort ? (
      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
        ⚠️ Stock = 0. Lot affecté à la prochaine entrée marchandise.
      </p>
    ) : partialShort ? (
      <p className="text-[11px] text-amber-600 mt-1">⚠️ {max} dispo seulement (le surplus sera à découvert)</p>
    ) : null}
    {/* GARDE-FOUS — anomalies de CETTE ligne (prix / volume), en direct.
        Ambre = « Avertir » (confirmable) · rouge = BLOQUANT. */}
    {lineSafeguards.map((v, vi) => (
      <p key={`sg-${vi}`} className={`flex items-start gap-1 text-[11px] mt-1 ${
        v.severity === "block"
          ? "text-rose-600 dark:text-rose-400 font-semibold"
          : "text-amber-600 dark:text-amber-400"
      }`}>
        <ShieldAlert className="h-3 w-3 shrink-0 mt-0.5" />
        <span>{v.message}{v.severity === "block" ? " — bloquant" : ""}</span>
      </p>
    ))}
    {/* Bon de commande : CHOIX DU LOT avant l'envoi (« valider propre »).
        Seuls les lots avec du stock physique TeleVent sont proposés ;
        « à affecter » = EM_PENDING, réglé plus tard dans l'onglet dédié. */}
    {isBonCommande && !locked && (
      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-dashed border-border/60">
        <span className="text-[11px] text-muted-foreground shrink-0">Lot :</span>
        <ConsoleLotPicker
          itemName={l.itemName}
          current={l.lot ?? null}
          candidates={lotCand?.candidates ?? []}
          suggested={lotCand?.suggested ?? null}
          onPick={(lot) => updateLine(i, { lot })}
        />
      </div>
    )}
    </div>
  );
}
