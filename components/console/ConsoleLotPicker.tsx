"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Boxes, CheckCircle2, AlertTriangle, Star, Truck, BadgeEuro } from "lucide-react";
import { StarRating } from "@/components/ui/star-rating";

/**
 * Sélecteur de LOT compact pour la console — choix du lot d'une ligne de bon de
 * commande AVANT l'envoi en SAP (« valider propre »).
 *
 * Chaque EM (entrée marchandise) est un lot distinct, présenté en FIFO (plus
 * ancienne entrée d'abord) avec, quand le registre TeleVent les connaît :
 * FOURNISSEUR · EM# · PRIX d'achat · COLIS RESTANT (par-EM) · ÉTOILES (qualité).
 * Les lots hors registre mais avec du stock physique restent proposés (repli,
 * sans colis-restant par-EM). Source : /api/lots/candidates.
 */

export interface ConsoleLotCandidate {
  lot: string;
  docNum: number;
  warehouse: string | null;
  affect: string;
  qty?: number | null;              // reste (registre) ou stock article×entrepôt (repli)
  colis?: number | null;            // reste en COLIS (registre uniquement)
  fromLedger?: boolean;             // true = colis-restant par-EM fiable
  supplierName?: string | null;
  purchasePrice?: number | null;
  currency?: string | null;
  rating?: number | null;           // note qualité 1..5 (étoiles)
  admissionDate?: string | null;
}

const AFFECT_LABEL: Record<string, string> = { TOUS: "Tous", EXPORT: "Export", GMS: "GMS", CHR: "CHR" };
const fmtColis = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

export function ConsoleLotPicker({
  itemName, current, candidates, suggested, disabled, onPick,
}: {
  itemName: string;
  current: string | null;                 // lot choisi (null/"" = à affecter)
  candidates: ConsoleLotCandidate[];
  suggested: string | null;
  disabled?: boolean;
  onPick: (lot: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const [manual, setManual] = useState("");   // saisie manuelle d'un n° d'EM
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 300);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const above = (window.innerHeight - r.bottom) < 340 && r.top > 340;
    setPos(above ? { left, width, bottom: window.innerHeight - r.top + 6 } : { left, width, top: r.bottom + 6 });
  };
  const openMenu = () => { if (disabled) return; place(); setOpen(true); };
  const closeMenu = () => { setOpen(false); setManual(""); };
  const pick = (v: string | null) => { onPick(v); closeMenu(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    const reflow = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open]);

  const cur = current ? candidates.find((c) => c.lot === current) : null;
  const label = !current ? "Lot à affecter" : cur ? cur.lot : current;

  // Ordre FIFO tel que renvoyé par l'API — on NE réordonne PAS ; le lot suggéré
  // (segment) est juste signalé par une étoile en place.
  return (
    <div className="inline-flex items-center gap-1.5">
      {!current
        ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
      <button
        ref={triggerRef}
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Lot de ${itemName}`}
        className={`h-8 min-w-[130px] rounded-md border bg-card px-2 flex items-center justify-between gap-1.5 text-left text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 ${
          !current ? "border-amber-400/60 text-amber-700 dark:text-amber-300" : "border-border text-foreground"
        }`}
      >
        <span className="inline-flex items-center gap-1 truncate"><Boxes className="h-3.5 w-3.5 opacity-70 shrink-0" />{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
          className="z-[120] rounded-xl border border-border bg-card shadow-modal overflow-hidden flex flex-col max-h-[60vh] animate-fade-up"
        >
          <p className="shrink-0 px-3 pt-2 pb-1 text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border/60">
            Lots — ordre FIFO (plus ancien d&apos;abord)
          </p>
          <div className="overflow-y-auto py-1 min-h-0">
            <button type="button" onClick={() => pick(null)}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-secondary/60 ${!current ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
              Lot à affecter — plus tard
            </button>
            {candidates.length === 0 ? (
              <p className="px-3 py-2 text-[11.5px] italic text-muted-foreground">Aucun lot en stock pour cet article.</p>
            ) : candidates.map((c) => {
              const sug = c.lot === suggested;
              const active = current === c.lot;
              return (
                <button key={c.lot} type="button" onClick={() => pick(c.lot)}
                  className={`w-full text-left px-3 py-1.5 hover:bg-secondary/60 ${active ? "bg-brand-500/10" : ""}`}>
                  {/* Ligne 1 : EM# · affectation · étoiles ........ colis restant / stock */}
                  <div className="flex items-center gap-1.5 text-[12.5px]">
                    {sug && <Star className="h-3 w-3 text-amber-500 fill-amber-400 shrink-0" aria-label="Lot suggéré" />}
                    <span className={`font-semibold text-foreground ${active ? "" : ""}`}>{c.lot}</span>
                    <span className="text-[10px] px-1 py-px rounded bg-secondary text-muted-foreground">{AFFECT_LABEL[c.affect] ?? c.affect}</span>
                    {c.rating ? <StarRating value={c.rating} size="sm" /> : null}
                    <span className="ml-auto shrink-0">
                      {c.fromLedger && c.colis != null && c.colis > 0 ? (
                        <span className="text-[10.5px] px-1.5 py-px rounded bg-brand-500/12 text-brand-700 dark:text-brand-300 font-bold tnum" title="Colis restants sur cette entrée (registre TeleVent)">
                          {fmtColis(c.colis)} colis
                        </span>
                      ) : c.qty != null && c.qty > 0 ? (
                        <span className="text-[10px] px-1 py-px rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 tnum" title="Stock physique de l'article dans cet entrepôt">
                          {Math.round(c.qty)} en stock
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {/* Ligne 2 : fournisseur · prix ........ magasin */}
                  {(c.supplierName || (c.purchasePrice != null && c.purchasePrice > 0) || c.warehouse) && (
                    <div className="mt-0.5 flex items-center gap-x-2.5 gap-y-0 flex-wrap text-[10.5px] text-muted-foreground tnum">
                      {c.supplierName && (
                        <span className="inline-flex items-center gap-1 min-w-0"><Truck className="h-3 w-3 shrink-0" /> <span className="truncate">{c.supplierName}</span></span>
                      )}
                      {c.purchasePrice != null && c.purchasePrice > 0 && (
                        <span className="inline-flex items-center gap-1"><BadgeEuro className="h-3 w-3" /> {c.purchasePrice.toFixed(2)} €{c.currency && c.currency !== "EUR" ? ` ${c.currency}` : ""}</span>
                      )}
                      {c.warehouse && <span className="ml-auto">mag. {c.warehouse}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Saisie manuelle : je tape les chiffres, ça affecte « EM<chiffres> ». */}
          <div className="shrink-0 border-t border-border/60 bg-secondary/30 px-2.5 py-2">
            <label className="block text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Ou saisir le n° d&apos;entrée
            </label>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center h-7 pl-2 pr-1 rounded-l-md border border-r-0 border-border bg-card text-[12px] font-semibold text-muted-foreground select-none">EM</span>
              <input
                type="text"
                inputMode="numeric"
                value={manual}
                onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter" && manual) { e.preventDefault(); pick(`EM${manual}`); } }}
                placeholder="23568"
                className="h-7 flex-1 min-w-0 rounded-none border border-border bg-card px-2 text-[12.5px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <button
                type="button"
                disabled={!manual}
                onClick={() => manual && pick(`EM${manual}`)}
                className="h-7 shrink-0 rounded-r-md border border-l-0 border-brand-500 bg-brand-500 px-2.5 text-[12px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-600"
              >
                OK
              </button>
            </div>
            {manual && <p className="mt-1 text-[10.5px] text-muted-foreground">Affecter le lot <span className="font-semibold text-foreground">EM{manual}</span></p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
