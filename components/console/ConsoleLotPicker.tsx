"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Boxes, CheckCircle2, AlertTriangle, Star } from "lucide-react";

/**
 * Sélecteur de LOT compact pour la console — utilisé UNIQUEMENT sur un bon de
 * commande, pour choisir le lot d'une ligne AVANT l'envoi en SAP (« valider
 * propre »). Ne propose que des lots avec du stock physique dans TeleVent
 * (l'endpoint /api/lots/candidates filtre déjà sur ProductStock). « Lot à
 * affecter » = on laisse EM_PENDING (choix reporté à l'onglet Bons de commande).
 */

export interface ConsoleLotCandidate {
  lot: string;
  docNum: number;
  warehouse: string | null;
  affect: string;
  qty?: number | null;   // stock physique (article×entrepôt) — indicatif
}

const AFFECT_LABEL: Record<string, string> = { TOUS: "Tous", EXPORT: "Export", GMS: "GMS", CHR: "CHR" };

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 260);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const above = (window.innerHeight - r.bottom) < 320 && r.top > 320;
    setPos(above ? { left, width, bottom: window.innerHeight - r.top + 6 } : { left, width, top: r.bottom + 6 });
  };
  const openMenu = () => { if (disabled) return; place(); setOpen(true); };
  const closeMenu = () => setOpen(false);
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

  // Lot suggéré en tête (s'il a du stock), puis les autres.
  const rows = [
    ...(suggested && candidates.some((c) => c.lot === suggested)
      ? [{ c: candidates.find((c) => c.lot === suggested)!, sug: true }]
      : []),
    ...candidates.filter((c) => c.lot !== suggested).map((c) => ({ c, sug: false })),
  ];

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
          <div className="overflow-y-auto py-1 min-h-0">
            <button type="button" onClick={() => pick(null)}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-secondary/60 ${!current ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
              Lot à affecter — plus tard
            </button>
            {rows.length === 0 ? (
              <p className="px-3 py-2 text-[11.5px] italic text-muted-foreground">Aucun lot en stock pour cet article.</p>
            ) : rows.map(({ c, sug }) => (
              <button key={c.lot} type="button" onClick={() => pick(c.lot)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 text-[12.5px] hover:bg-secondary/60 ${current === c.lot ? "bg-brand-500/10 font-semibold" : "text-foreground"}`}>
                {sug && <Star className="h-3 w-3 text-amber-500 fill-amber-400 shrink-0" />}
                <span className="font-semibold text-foreground">{c.lot}</span>
                <span className="text-[10px] px-1 py-px rounded bg-secondary text-muted-foreground">{AFFECT_LABEL[c.affect] ?? c.affect}</span>
                {c.qty != null && c.qty > 0 && (
                  <span className="text-[10px] px-1 py-px rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 tnum">{Math.round(c.qty)} en stock</span>
                )}
                {c.warehouse && <span className="text-[10.5px] text-muted-foreground ml-auto">mag. {c.warehouse}</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
