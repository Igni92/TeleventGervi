"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Cible post-login par défaut — alignée sur la racine (app/page.tsx). */
const DEFAULT_TARGET = "/accueil";

/**
 * Cible de retour après authentification : honore le ?callbackUrl posé par
 * le middleware (proxy.ts) quand l'utilisateur visait une page précise,
 * sinon /accueil. Chemins RELATIFS uniquement (jamais d'URL absolue —
 * anti open-redirect), et jamais /login (boucle).
 */
function resolveCallbackUrl(): string {
  const raw = new URLSearchParams(window.location.search).get("callbackUrl");
  if (!raw) return DEFAULT_TARGET;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) {
    return DEFAULT_TARGET;
  }
  return raw;
}

/** Logo Microsoft monochrome (currentColor) — version sobre, sans couleurs. */
function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="currentColor" />
      <rect x="11" y="1" width="9" height="9" fill="currentColor" opacity="0.75" />
      <rect x="1" y="11" width="9" height="9" fill="currentColor" opacity="0.75" />
      <rect x="11" y="11" width="9" height="9" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

export function LoginButton() {
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signIn("microsoft-entra-id", { callbackUrl: resolveCallbackUrl() });
    } catch {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleSignIn}
      disabled={loading}
      size="xl"
      className="w-full"
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" />
          Connexion en cours…
        </>
      ) : (
        <>
          <MicrosoftMark />
          Continuer avec Microsoft 365
        </>
      )}
    </Button>
  );
}
