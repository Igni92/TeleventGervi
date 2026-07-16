"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <FullscreenPanel /> — détail « pleine page » des lignes déroulantes.
 *
 * Demande client : dans Réceptions de marchandise, Commandes fournisseurs,
 * Bons de commande… quand une ligne se déroule, ON OUBLIE LE FOND : le détail
 * occupe tout l'écran sur un fond OPAQUE, avec un en-tête net (retour + titre
 * en grand) et un contenu qui scrolle. Remplace les accordéons in-line.
 *
 * Bâti sur Radix Dialog : focus trap, Échap pour fermer, scroll lock, a11y.
 *
 *   <FullscreenPanel
 *     open={!!selected}
 *     onOpenChange={(o) => !o && setSelected(null)}
 *     title={selected?.fournisseur}
 *     subtitle="Réception du 16/07"
 *     actions={<Button>Valider</Button>}
 *   >
 *     …détail…
 *   </FullscreenPanel>
 */

interface FullscreenPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Titre héros — l'info la plus importante, en grand et en clair. */
  title: React.ReactNode;
  /** Ligne secondaire sous le titre (statut, date…). */
  subtitle?: React.ReactNode;
  /** Zone d'actions à droite de l'en-tête (boutons Valider, Imprimer…). */
  actions?: React.ReactNode;
  /** Pastille/valeur mise en avant à droite du titre (ex. total €). */
  highlight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Largeur max du contenu interne (le fond reste plein écran). */
  contentWidth?: "full" | "reading";
}

export function FullscreenPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  actions,
  highlight,
  children,
  className,
  contentWidth = "full",
}: FullscreenPanelProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Fond totalement OPAQUE : l'écran d'origine disparaît. */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "duration-200",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-background outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.99]",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "duration-200 ease-out",
            className,
          )}
        >
          {/* ── En-tête : retour + titre héros + actions ─────────────── */}
          <header className="shrink-0 border-b border-border bg-card/60 backdrop-blur-sm">
            <div
              className={cn(
                "mx-auto flex w-full items-center gap-3 px-3 py-3 sm:px-6 sm:py-4",
                contentWidth === "reading" && "max-w-5xl",
              )}
            >
              <DialogPrimitive.Close
                aria-label="Retour"
                className={cn(
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  "border border-border bg-card text-foreground",
                  "hover:bg-secondary active:scale-[0.97]",
                  "transition-[background-color,transform] duration-150 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <ArrowLeft className="h-5 w-5" />
              </DialogPrimitive.Close>

              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title asChild>
                  <h2 className="font-display truncate text-xl font-bold text-foreground sm:text-2xl">
                    {title}
                  </h2>
                </DialogPrimitive.Title>
                {subtitle && (
                  <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                    {subtitle}
                  </div>
                )}
              </div>

              {highlight && (
                <div className="font-display shrink-0 text-right text-lg font-bold text-primary sm:text-2xl tnum">
                  {highlight}
                </div>
              )}

              {actions && (
                <div className="hidden shrink-0 items-center gap-2 sm:flex">{actions}</div>
              )}

              <DialogPrimitive.Close
                aria-label="Fermer"
                className={cn(
                  "hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:inline-flex",
                  "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  "active:scale-[0.97] transition-[background-color,color,transform] duration-150 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>
            {/* Actions sur leur propre ligne en mobile (l'en-tête reste net). */}
            {actions && (
              <div className="flex items-center gap-2 overflow-x-auto px-3 pb-3 sm:hidden">
                {actions}
              </div>
            )}
          </header>

          {/* ── Contenu scrollable ───────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div
              className={cn(
                "mx-auto w-full px-3 py-4 sm:px-6 sm:py-6",
                contentWidth === "reading" && "max-w-5xl",
              )}
            >
              {children}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
