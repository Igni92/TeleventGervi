"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home, ShieldCheck } from "lucide-react";

/**
 * Filet de sécurité runtime — page d'erreur de segment.
 *
 * Objectif : ne JAMAIS exposer une erreur brute (stack/trace) à la Direction.
 * Ton volontairement rassurant. On garde le composant autonome (pas d'import
 * de layout) pour qu'il reste robuste même si une dépendance plante.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Journalise discrètement côté client (console only) — utile au support.
  // On n'affiche jamais la stack à l'utilisateur.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card text-card-foreground shadow-sm p-8 text-center">
        {/* Icône rassurante */}
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertTriangle className="h-7 w-7" strokeWidth={2} aria-hidden />
        </div>

        <h1 className="text-xl font-semibold tracking-tight">
          Une erreur est survenue
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Pas d&apos;inquiétude&nbsp;: <strong className="font-medium text-foreground">vos données sont en sécurité</strong>.
          Vous pouvez réessayer immédiatement ou revenir à l&apos;accueil.
        </p>

        {/* Réassurance « données protégées » */}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span>Aucune donnée n&apos;a été perdue.</span>
        </div>

        {/* Actions */}
        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 h-10 text-[14px] font-semibold text-primary-foreground shadow-[0_2px_10px_rgba(250,204,21,0.25)] transition-all duration-150 hover:brightness-105 hover:shadow-[0_4px_18px_rgba(250,204,21,0.4)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Réessayer
          </button>

          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 h-10 text-[14px] font-medium text-foreground transition-[background-color,border-color,color,transform] duration-150 hover:bg-secondary hover:border-input active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Home className="h-4 w-4" aria-hidden />
            Retour à l&apos;accueil
          </Link>
        </div>

        {/* Référence support discrète — pas de stack, juste le digest */}
        {error.digest ? (
          <p className="mt-6 text-[11px] text-muted-foreground/70">
            Référence support&nbsp;: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
