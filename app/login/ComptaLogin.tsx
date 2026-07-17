"use client";

/**
 * ACCÈS CABINET COMPTABLE — compta@gervifrais.com est une boîte PARTAGÉE
 * Microsoft (pas de SSO possible) : connexion par MOT DE PASSE dédié, canal
 * volontairement SÉPARÉ du bouton Microsoft. Replié par défaut (l'équipe passe
 * par le SSO), il se déplie d'un clic discret sous le bouton principal.
 */
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Loader2, Calculator } from "lucide-react";

const DEFAULT_EMAIL = "compta@gervifrais.com";

export function ComptaLogin() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError("");
    try {
      const res = await signIn("comptable", { email, password, redirect: false });
      if (res?.error) {
        setError("Identifiants incorrects.");
        setLoading(false);
        return;
      }
      window.location.href = "/salaires";
    } catch {
      setError("Connexion impossible — réessayez.");
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-center text-[12px] text-white/35 hover:text-white/60 transition-colors"
      >
        Accès cabinet comptable →
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5 space-y-2.5">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-white/45">
        <Calculator className="h-3.5 w-3.5" /> Cabinet comptable
      </p>
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        autoComplete="username" placeholder="compta@gervifrais.com" aria-label="Email comptable"
        className="w-full h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[13px] text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-brand-400"
      />
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password" placeholder="Mot de passe" aria-label="Mot de passe comptable"
        className="w-full h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[13px] text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-brand-400"
      />
      {error && <p className="text-[12px] text-rose-400">{error}</p>}
      <button
        type="submit" disabled={loading || !password}
        className="w-full h-10 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Se connecter
      </button>
      <p className="text-[10.5px] leading-snug text-white/25">
        Accès dédié (planning + éléments des salaires), indépendant de Microsoft 365.
      </p>
    </form>
  );
}
