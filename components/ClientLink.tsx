"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Lien universel vers la fiche client — utilisable PARTOUT où un client est
 * affiché (plan d'appel, encours, tops pilotage, console, fiche commercial…).
 *
 * Résout le code SAP (CardCode) vers la fiche locale via
 * GET /api/clients/resolve?code=… puis navigue vers /clients/[id].
 * Si le client n'existe pas localement → texte simple (pas de lien mort).
 *
 *   <ClientLink code="APLAI" name="A PLAISIR" />
 */
export function ClientLink({ code, name, className, preferCode }: {
  code: string;
  name?: string | null;
  className?: string;
  /** Affiche le CODE client comme libellé principal (le nom passe en infobulle). */
  preferCode?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = preferCode ? code : (name?.trim() || code);

  const open = async (e: React.MouseEvent) => {
    // Ne pas déclencher les onClick parents (lignes cliquables, cartes…)
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/clients/resolve?code=${encodeURIComponent(code)}`);
      const j = await r.json().catch(() => null);
      if (j?.id) router.push(`/clients/${j.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      title={`Ouvrir la fiche ${name?.trim() ? `${name.trim()} (${code})` : code}`}
      className={className ?? "text-left hover:underline decoration-brand-500/60 underline-offset-2 cursor-pointer disabled:opacity-60"}
      disabled={busy}
    >
      {label}
    </button>
  );
}
