"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export function LoginButton() {
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signIn("microsoft-entra-id", { callbackUrl: "/console" });
    } catch {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleSignIn}
      disabled={loading}
      className="w-full h-11 rounded-xl font-medium text-[14px] flex items-center justify-center gap-3
                 bg-white text-slate-800 transition-all duration-200
                 shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_8px_rgba(0,0,0,0.08)]
                 hover:bg-slate-50 hover:shadow-[0_3px_12px_rgba(0,0,0,0.18)]
                 active:scale-[0.98] active:shadow-sm
                 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
          <span className="text-slate-500">Connexion en cours…</span>
        </>
      ) : (
        <>
          {/* Microsoft logo */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 21 21"
            className="h-[18px] w-[18px] shrink-0"
            aria-hidden="true"
          >
            <rect x="1"  y="1"  width="9" height="9" fill="#F25022" />
            <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" />
            <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          Continuer avec Microsoft 365
        </>
      )}
    </button>
  );
}
