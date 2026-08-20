"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Ban, Send } from "lucide-react";
import { SALESPEOPLE } from "@/lib/salespeople";
import type { Client } from "./shared";

/** Menu contextuel d'une ligne de file (clic droit) : inactiver / réassigner. */
export function ClientContextMenu({
  menu, meInitials, onClose, onDeactivate, onReassign,
}: {
  menu: { x: number; y: number; client: Client };
  meInitials: string | null;
  onClose: () => void;
  onDeactivate: (client: Client) => void;
  onReassign: (client: Client, initials: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const targets = SALESPEOPLE.filter((s) => s.initials !== meInitials);
  // Repositionne le menu pour rester dans la fenêtre (bord droit / bas).
  const MW = 224;
  const MH = 92 + targets.length * 34;
  const vw = typeof window !== "undefined" ? window.innerWidth : 9999;
  const vh = typeof window !== "undefined" ? window.innerHeight : 9999;
  const left = Math.max(8, Math.min(menu.x, vw - MW - 8));
  const top = Math.max(8, Math.min(menu.y, vh - MH - 8));
  const item = "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-secondary transition-colors";

  return createPortal(
    <div
      data-floating-root=""
      // `pointer-events-auto` OBLIGATOIRE quand ce menu s'ouvre au-dessus d'un
      // Dialog Radix (modal) : Radix pose `pointer-events:none` sur <body>, dont
      // ce portail hérite — les clics traverseraient le menu (items sans onClick)
      // et le fond ne pourrait plus le fermer.
      className="pointer-events-auto fixed inset-0 z-[130]"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <div
        className="absolute min-w-[224px] rounded-xl border border-border bg-card shadow-2xl py-1.5 animate-fade-in"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-3 pb-1 text-[11px] font-semibold text-foreground truncate">{menu.client.nom}</p>
        <button type="button" className={item} onClick={() => onDeactivate(menu.client)}>
          <Ban className="h-4 w-4 shrink-0 text-rose-500" /> Passer en inactif
        </button>
        <div className="my-1 h-px bg-border/70" />
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Envoyer à</p>
        {targets.length === 0 ? (
          <p className="px-3 py-1 text-[12px] italic text-muted-foreground">Aucun autre commercial</p>
        ) : targets.map((s) => (
          <button key={s.initials} type="button" className={item} onClick={() => onReassign(menu.client, s.initials)}>
            <Send className="h-4 w-4 shrink-0 text-brand-500" /> {s.firstName || s.initials}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
