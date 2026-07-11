"use client";

import { Toaster as Sonner } from "sonner";
import { CircleCheck, CircleAlert, TriangleAlert, Info, LoaderCircle } from "lucide-react";

/* Toaster maison — carte « verre » + icône teintée + boutons en pied.
   Tout le style vit dans globals.css (section « Sonner toast »).
   Pas de `richColors` : la couleur porte sur la pastille d'icône, pas sur
   toute la carte — plus calme, plus lisible, cohérent avec les surfaces. */
export function AppToaster() {
  return (
    <Sonner
      position="top-right"
      gap={10}
      visibleToasts={4}
      closeButton
      style={{ "--width": "384px" } as React.CSSProperties}
      icons={{
        success: <CircleCheck size={15} strokeWidth={2.25} aria-hidden />,
        error: <CircleAlert size={15} strokeWidth={2.25} aria-hidden />,
        warning: <TriangleAlert size={15} strokeWidth={2.25} aria-hidden />,
        info: <Info size={15} strokeWidth={2.25} aria-hidden />,
        loading: <LoaderCircle size={15} strokeWidth={2.25} className="animate-spin" aria-hidden />,
      }}
      toastOptions={{
        style: { fontFamily: "var(--font-inter, Inter, sans-serif)" },
      }}
    />
  );
}
