"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isPreviewRole, PREVIEW_ROLE_LABELS, type PreviewRole } from "@/lib/rolePreview";

/**
 * Contexte de l'aperçu « voir comme ». Deux usages :
 *   • un RÔLE seul (sélecteur admin — RolePreviewControl) ;
 *   • une PERSONNE avec TOUS ses rôles (tuiles d'équipe — « Voir comme Hugo »).
 * Dans les deux cas on stocke un ensemble de rôles + un libellé. Transitoire et
 * par onglet (sessionStorage) — outil de vérification, pas une préférence. Un
 * compte non autorisé (`canPreview=false`) ne prévisualise jamais.
 */

const KEY = "tv-preview-role";

export interface Preview { roles: PreviewRole[]; label: string }

interface RolePreviewCtx {
  canPreview: boolean;
  preview: Preview | null;
  previewRoles: PreviewRole[];
  previewLabel: string | null;
  /** Rôle unique si l'aperçu ne cible qu'un rôle (sinon null) — compat sélecteur. */
  previewRole: PreviewRole | null;
  /** Aperçu « personne » : tous ses rôles + son nom. */
  setPreview: (roles: PreviewRole[], label: string) => void;
  /** Aperçu d'un rôle unique (sélecteur admin). */
  setPreviewRole: (r: PreviewRole | null) => void;
  clearPreview: () => void;
}

const RolePreviewContext = createContext<RolePreviewCtx>({
  canPreview: false, preview: null, previewRoles: [], previewLabel: null, previewRole: null,
  setPreview: () => {}, setPreviewRole: () => {}, clearPreview: () => {},
});

/** Parse le storage : ancien format = rôle simple ; nouveau = JSON {roles,label}. */
function parseStored(raw: string | null): Preview | null {
  if (!raw) return null;
  if (isPreviewRole(raw)) return { roles: [raw], label: PREVIEW_ROLE_LABELS[raw] };
  try {
    const o = JSON.parse(raw) as { roles?: unknown; label?: unknown };
    const roles = Array.isArray(o.roles) ? o.roles.filter(isPreviewRole) : [];
    if (roles.length === 0) return null;
    return { roles, label: typeof o.label === "string" && o.label ? o.label : PREVIEW_ROLE_LABELS[roles[0]] };
  } catch { return null; }
}

export function RolePreviewProvider({
  canPreview, children,
}: { canPreview: boolean; children: React.ReactNode }) {
  const [preview, setPrev] = useState<Preview | null>(null);

  // Hydrate depuis sessionStorage après le 1er paint (évite un mismatch SSR).
  useEffect(() => {
    if (!canPreview) return;
    try { const p = parseStored(sessionStorage.getItem(KEY)); if (p) setPrev(p); } catch { /* storage indispo */ }
  }, [canPreview]);

  const persist = useCallback((p: Preview | null) => {
    setPrev(p);
    try {
      if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
      else sessionStorage.removeItem(KEY);
    } catch { /* quota / storage indispo */ }
  }, []);

  const setPreview = useCallback((roles: PreviewRole[], label: string) => {
    const clean = roles.filter(isPreviewRole);
    persist(clean.length ? { roles: clean, label } : null);
  }, [persist]);

  const setPreviewRole = useCallback((r: PreviewRole | null) => {
    persist(r ? { roles: [r], label: PREVIEW_ROLE_LABELS[r] } : null);
  }, [persist]);

  const clearPreview = useCallback(() => persist(null), [persist]);

  // Garde-fou : un compte non autorisé ne prévisualise jamais.
  const effective = canPreview ? preview : null;

  return (
    <RolePreviewContext.Provider value={{
      canPreview,
      preview: effective,
      previewRoles: effective?.roles ?? [],
      previewLabel: effective?.label ?? null,
      previewRole: effective && effective.roles.length === 1 ? effective.roles[0] : null,
      setPreview, setPreviewRole, clearPreview,
    }}>
      {children}
    </RolePreviewContext.Provider>
  );
}

export function useRolePreview(): RolePreviewCtx {
  return useContext(RolePreviewContext);
}
