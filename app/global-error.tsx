"use client";

import { useEffect } from "react";

/**
 * Filet de sécurité ULTIME — erreur racine (remplace le root layout).
 *
 * Contraintes Next.js : un global-error DOIT rendre ses propres <html> et
 * <body>, et reste isolé (le layout, ses providers et son thème ne sont PAS
 * montés). On utilise donc des styles inline auto-portants pour garantir un
 * rendu propre et rassurant même si la feuille de styles globale ne s'applique
 * pas. Ton volontairement rassurant — aucune stack exposée à l'utilisateur.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          backgroundColor: "#11141a",
          color: "#eef1f6",
          fontFamily:
            'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "440px",
            boxSizing: "border-box",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.08)",
            backgroundColor: "#171b22",
            boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            padding: "32px",
            textAlign: "center",
          }}
        >
          {/* Icône rassurante (SVG inline pour rester autonome) */}
          <div
            style={{
              margin: "0 auto 20px",
              height: "56px",
              width: "56px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "16px",
              backgroundColor: "rgba(245,158,11,0.12)",
              color: "#f59e0b",
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Une erreur est survenue
          </h1>

          <p
            style={{
              margin: "12px 0 0",
              fontSize: "14px",
              lineHeight: 1.6,
              color: "#9aa4b2",
            }}
          >
            Pas d&apos;inquiétude&nbsp;:{" "}
            <strong style={{ color: "#eef1f6", fontWeight: 500 }}>
              vos données sont en sécurité
            </strong>
            . Vous pouvez réessayer l&apos;opération.
          </p>

          <div
            style={{
              marginTop: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              fontSize: "12px",
              color: "#9aa4b2",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span>Aucune donnée n&apos;a été perdue.</span>
          </div>

          <div style={{ marginTop: "28px" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                height: "40px",
                padding: "0 24px",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
                color: "#1a1505",
                backgroundColor: "#facc15",
                boxShadow: "0 2px 10px rgba(250,204,21,0.25)",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Réessayer
            </button>
          </div>

          {/* Référence support discrète — pas de stack exposée */}
          {error.digest ? (
            <p
              style={{
                marginTop: "24px",
                fontSize: "11px",
                color: "rgba(154,164,178,0.7)",
              }}
            >
              Référence support&nbsp;:{" "}
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {error.digest}
              </span>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
