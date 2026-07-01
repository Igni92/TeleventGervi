"use client";

import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { useRolePreview } from "./RolePreviewProvider";
import { PREVIEW_ROLES, PREVIEW_ROLE_LABELS, previewHome, type PreviewRole } from "@/lib/rolePreview";

/**
 * Barre « Voir comme » de l'écran Effectifs (admin / direction uniquement) : bascule
 * l'aperçu de chrome vers un rôle (Préparateur / Livreur / Commercial / Direction)
 * ou revient à la vue réelle. Remplace l'ancien sélecteur global du menu latéral.
 */
export function EffectifsPreviewBar() {
  const router = useRouter();
  const { canPreview, previewRole, setPreviewRole } = useRolePreview();
  if (!canPreview) return null;

  const pick = (role: PreviewRole | null) => {
    setPreviewRole(role);
    if (role) router.push(previewHome(role));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        <Eye className="h-4 w-4" /> Voir comme
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => pick(null)}
          aria-pressed={!previewRole}
          className={`h-8 px-3 rounded-lg border text-[12.5px] font-semibold transition-colors ${
            !previewRole
              ? "bg-foreground text-background border-foreground"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }`}
        >
          Vue réelle
        </button>
        {PREVIEW_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => pick(role)}
            aria-pressed={previewRole === role}
            className={`h-8 px-3 rounded-lg border text-[12.5px] font-semibold transition-colors ${
              previewRole === role
                ? "bg-amber-500 text-white border-amber-500"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            {PREVIEW_ROLE_LABELS[role]}
          </button>
        ))}
      </div>
      {previewRole && (
        <span className="ml-auto text-[11px] font-medium text-amber-600 dark:text-amber-400">
          Aperçu actif — mise en page uniquement, aucun droit modifié
        </span>
      )}
    </div>
  );
}
