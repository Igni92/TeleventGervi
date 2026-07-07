"use client";

/**
 * Menu contextuel léger (clic droit) — positionné au curseur, portalisé, fermé
 * au clic dehors / Échap / scroll / resize. Pas de dépendance Radix (celui-ci
 * s'ouvre sur `onContextMenu`, pas sur un clic gauche de trigger).
 */
import { useCallback, useEffect, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

export function useContextMenu(clampW = 220, clampH = 220) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const openAt = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - clampW),
      y: Math.min(e.clientY, window.innerHeight - clampH),
    });
  }, [clampW, clampH]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);
  return { menu, openAt, close };
}

export function ContextMenu({
  menu, onClose, minWidth = 210, header, children,
}: {
  menu: { x: number; y: number } | null;
  onClose: () => void;
  minWidth?: number;
  header?: ReactNode;
  children: ReactNode;
}) {
  if (!menu || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        role="menu"
        className="fixed z-50 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg animate-fade-up"
        style={{ top: menu.y, left: menu.x, minWidth }}
      >
        {header}
        {children}
      </div>
    </>,
    document.body,
  );
}

export function ContextMenuItem({
  icon: Icon, children, onClick, accent,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onClick: () => void;
  accent?: "danger" | "success";
}) {
  return (
    <button
      type="button" role="menuitem" onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-left transition-colors hover:bg-secondary/60 ${
        accent === "danger" ? "text-rose-600 dark:text-rose-400"
        : accent === "success" ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground/85"
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </button>
  );
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
      {children}
    </div>
  );
}

export function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
