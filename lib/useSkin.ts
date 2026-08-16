"use client";

import { useEffect, useState } from "react";

/**
 * Skin d'interface courant, lu sur <html data-skin>. Sert aux retouches
 * STRUCTURELLES du skin Apple que le CSS ne peut pas faire proprement
 * (retrait d'éléments décoratifs, sortie du thème sombre forcé localement…).
 *
 * SSR-safe : rend "classic" au serveur ET au 1er rendu client (l'hydratation
 * concorde), puis passe à la vraie valeur après montage — donc seuls les
 * quelques composants qui l'utilisent se re-rendent, sans mismatch d'hydratation.
 * Réactif : suit le basculement du réglage (MutationObserver sur data-skin).
 */
export function useSkin(): "classic" | "apple" {
  const [skin, setSkin] = useState<"classic" | "apple">("classic");
  useEffect(() => {
    const read = () =>
      setSkin(document.documentElement.getAttribute("data-skin") === "apple" ? "apple" : "classic");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
    return () => obs.disconnect();
  }, []);
  return skin;
}

/** true si le skin Apple est actif (raccourci). */
export function useIsApple(): boolean {
  return useSkin() === "apple";
}
