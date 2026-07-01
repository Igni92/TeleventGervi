"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker `/sw.js` dès le chargement de l'app.
 *
 * Nécessaire pour rendre la PWA « installable » (bouton Installer sur
 * Android/desktop) sans attendre que l'utilisateur active les notifications.
 * Le SW gère le push + un handler fetch pass-through (pas de cache offline).
 * Idempotent : ré-enregistrer ne crée pas de doublon.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* silencieux : l'app fonctionne même si le SW échoue */
      });
    };
    // Après le load pour ne pas concurrencer le rendu initial.
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
