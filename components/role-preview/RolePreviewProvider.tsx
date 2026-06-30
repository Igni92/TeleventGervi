"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isPreviewRole, type PreviewRole } from "@/lib/rolePreview";

/**
 * Contexte de l'aperçu « voir comme » (rôle prévisualisé). Transitoire et par
 * onglet (sessionStorage) — c'est un outil de vérification admin, pas une
 * préférence durable. `canPreview` vient du serveur (admin/direction) : un
 * non-autorisé ne prévisualise jamais, même si la valeur traîne en storage.
 */

const KEY = "tv-preview-role";

interface RolePreviewCtx {
  canPreview: boolean;
  previewRole: PreviewRole | null;
  setPreviewRole: (r: PreviewRole | null) => void;
}

const RolePreviewContext = createContext<RolePreviewCtx>({
  canPreview: false,
  previewRole: null,
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

  // Hydrate depuis sessionStorage après le 1er paint (évite un mismatch SSR).
  useEffect(() => {
    if (!canPreview) return;
    try {
      const v = sessionStorage.getItem(KEY);
      if (isPreviewRole(v)) setRole(v);
    } catch {
      /* storage indisponible */
    }
  }, [canPreview]);

  const setPreviewRole = useCallback((r: PreviewRole | null) => {
    setRole(r);
    try {
      if (r) sessionStorage.setItem(KEY, r);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* quota / storage indisponible */
    }
  }, []);

  // Garde-fou : un compte non autorisé ne prévisualise jamais.
  const effective = canPreview ? previewRole : null;

  return (
    <RolePreviewContext.Provider value={{ canPreview, previewRole: effective, setPreviewRole }}>
      {children}
    </RolePreviewContext.Provider>
  );
}

export function useRolePreview(): RolePreviewCtx {
  return useContext(RolePreviewContext);
}
