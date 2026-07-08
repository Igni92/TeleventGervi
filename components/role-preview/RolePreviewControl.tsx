"use client";

import { useRouter } from "next/navigation";
import { Eye, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRolePreview } from "./RolePreviewProvider";
import { PREVIEW_ROLES, PREVIEW_ROLE_LABELS, previewHome, type PreviewRole } from "@/lib/rolePreview";

/**
 * Sélecteur « voir comme » (admin/direction). Bascule l'aperçu de chrome vers un
 * rôle (Préparateur / Commercial / Direction) ou revient à la vue réelle. À la
 * sélection d'un rôle, on ouvre sa page d'atterrissage pour voir « la page telle
 * qu'il la verrait ». Rendu uniquement si `canPreview`.
 */
export function RolePreviewControl({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { canPreview, previewRole, previewLabel, setPreviewRole } = useRolePreview();
  if (!canPreview) return null;

  const pick = (role: PreviewRole | null) => {
    setPreviewRole(role);
    if (role) router.push(previewHome(role));
  };

  const active = previewLabel != null;
  const activeLabel = previewLabel ?? "Vue réelle";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Voir comme"
          title={`Voir comme : ${activeLabel}`}
          className={
            compact
              ? `inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  active
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30"
                    : "text-foreground/55 hover:text-foreground hover:bg-secondary/70"
                }`
              : `flex w-full items-center gap-2 rounded-lg px-2.5 h-9 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
                  active
                    ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                    : "text-white/70 hover:text-white/90 hover:bg-white/[0.05]"
                }`
          }
        >
          <Eye className="h-[18px] w-[18px] shrink-0" />
          {!compact && (
            <>
              <span className="truncate">{activeLabel}</span>
              <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-52 rounded-xl p-1">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">Voir comme</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => pick(null)}
          className="cursor-pointer rounded-lg text-[13px] gap-2"
        >
          <Check className={`h-3.5 w-3.5 ${active ? "opacity-0" : "opacity-100"}`} />
          Vue réelle (moi)
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1" />
        {PREVIEW_ROLES.map((role) => (
          <DropdownMenuItem
            key={role}
            onClick={() => pick(role)}
            className="cursor-pointer rounded-lg text-[13px] gap-2"
          >
            <Check className={`h-3.5 w-3.5 ${previewRole === role ? "opacity-100" : "opacity-0"}`} />
            {PREVIEW_ROLE_LABELS[role]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
