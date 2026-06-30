"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isPreviewRole, type PreviewRole } from "@/lib/rolePreview";

/**
 * Contexte de l'aperçu « voir comme » (rôle prévisualisé + libellé nominatif
 * optionnel). Transitoire et par onglet (sessionStorage) — c'est un outil de
 * vérification admin, pas une préférence durable. `canPreview` vient du serveur
 * (admin/direction) : un non-autorisé ne prévisualise jamais, même si la valeur
 * traîne en storage.
 *
 * `previewLabel` permet d'afficher QUI l'on prévisualise (ex. « Hugo VACHEY »)
 * quand l'aperçu est lancé depuis une carte de l'équipe — le bandeau dit alors
 * « vous voyez ce que VOIT cette personne », pas seulement « ce rôle ».
 */

const KEY = "tv-preview-role";
const LABEL_KEY = "tv-preview-label";

interface RolePreviewCtx {
  canPreview: boolean;
  previewRole: PreviewRole | null;
  previewLabel: string | null;
  setPreviewRole: (r: PreviewRole | null, label?: string | null) => void;
}

const RolePreviewContext = createContext<RolePreviewCtx>({
  canPreview: false,
  previewRole: null,
  previewLabel: null,
  setPreviewRole: () => {},
});

export function RolePreviewProvider({
  canPreview,
  children,
}: {
  canPreview: boolean;
  children: React.ReactNode;
}) {
  const [previewRole, setRole] = useState<PreviewRole | null>(null);
  const [previewLabel, setLabel] = useState<string | null>(null);

  // Hydrate depuis sessionStorage après le 1er paint (évite un mismatch SSR).
  useEffect(() => {
    if (!canPreview) return;
    try {
      const v = sessionStorage.getItem(KEY);
      if (isPreviewRole(v)) {
        setRole(v);
        setLabel(sessionStorage.getItem(LABEL_KEY) || null);
      }
    } catch {
      /* storage indisponible */
    }
  }, [canPreview]);

  const setPreviewRole = useCallback((r: PreviewRole | null, label: string | null = null) => {
    setRole(r);
    setLabel(r ? label : null);
    try {
      if (r) {
        sessionStorage.setItem(KEY, r);
        if (label) sessionStorage.setItem(LABEL_KEY, label);
        else sessionStorage.removeItem(LABEL_KEY);
      } else {
        sessionStorage.removeItem(KEY);
        sessionStorage.removeItem(LABEL_KEY);
      }
    } catch {
      /* quota / storage indisponible */
    }
  }, []);

  // Garde-fou : un compte non autorisé ne prévisualise jamais.
  const effective = canPreview ? previewRole : null;
  const effectiveLabel = canPreview ? previewLabel : null;

  return (
    <RolePreviewContext.Provider
      value={{ canPreview, previewRole: effective, previewLabel: effectiveLabel, setPreviewRole }}
    >
      {children}
    </RolePreviewContext.Provider>
  );
}

export function useRolePreview(): RolePreviewCtx {
  return useContext(RolePreviewContext);
}
