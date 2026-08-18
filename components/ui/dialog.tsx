"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Voile : simple assombrissement 40 %, jamais de flou d'arrière-plan.
      "fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Largeurs de feuille — `md` conserve l'ancien défaut (max-w-lg). Un `max-w-*`
// passé en className garde la priorité (twMerge), rien ne casse chez les
// consommateurs existants.
const dialogSizeClasses = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

type DialogSize = keyof typeof dialogSizeClasses;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: DialogSize }
>(({ className, children, size = "md", onPointerDownOutside, onFocusOutside, onInteractOutside, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // `grid-cols-1` (minmax(0,1fr)) : sans elle, la piste implicite prend le
        // min-content du plus LARGE enfant (ex. un bouton au long libellé) et tout
        // le contenu déborde du panneau sur écran étroit (iPhone zoomé ~320px).
        // Largeur : marge latérale de 12px conservée sur mobile (plus de panneau
        // bord à bord) + coins arrondis sur toutes les tailles.
        // Surface : carte OPAQUE (bg-card) sur le voile — le contour demi-pixel
        // est déjà porté par --shadow-modal, pas de bordure 1px en plus.
        "fixed left-[50%] top-[50%] z-50 grid grid-cols-1 w-[calc(100%-1.5rem)] translate-x-[-50%] translate-y-[-50%] gap-4 bg-card p-4 sm:p-6 shadow-modal duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl",
        dialogSizeClasses[size],
        className
      )}
      // Les menus/comboboxes maison (TypeCombobox, ConsoleLotPicker, ContextMenu…)
      // sont portalisés dans <body>, donc HORS de cet arbre DOM. Sans ceci, Radix
      // voit un clic dedans comme un clic EXTÉRIEUR et ferme toute la modale avant
      // même que le bouton cliqué ne reçoive son propre onClick (l'option ne se
      // sélectionne jamais, la modale se ferme à la place).
      //
      // Le clic ne suffit pas : sélectionner un bouton/input dans ce portail lui
      // donne le FOCUS, qui est LUI AUSSI hors de l'arbre DOM du Dialog. En mode
      // modal, Radix referme aussi sur un focus « sorti » (onFocusOutside,
      // indépendant de onPointerDownOutside) — sans ce second garde-fou, la
      // modale se refermait encore au clic sur une option focusable, même une
      // fois le clic lui-même neutralisé ci-dessus.
      onPointerDownOutside={(e) => {
        const t = e.detail.originalEvent.target as HTMLElement | null;
        if (t?.closest("[data-floating-root]")) { e.preventDefault(); return; }
        onPointerDownOutside?.(e);
      }}
      onFocusOutside={(e) => {
        const t = e.detail.originalEvent.target as HTMLElement | null;
        if (t?.closest("[data-floating-root]")) { e.preventDefault(); return; }
        onFocusOutside?.(e);
      }}
      onInteractOutside={(e) => {
        const t = e.detail.originalEvent.target as HTMLElement | null;
        if (t?.closest("[data-floating-root]")) { e.preventDefault(); return; }
        onInteractOutside?.(e);
      }}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
