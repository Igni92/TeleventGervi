"use client";

import { useEffect } from "react";
import { SETTING_KEYS, onSettingChange, readSetting } from "@/components/settings/app-settings";

/**
 * Pont entre le réglage `televente:animations` (page /parametres) et le fond
 * d'ambiance (AmbientBackground / globals.css).
 *
 * Pose `data-reduce-anim="1"` sur <html> quand les animations doivent être
 * coupées, sinon retire l'attribut. globals.css traduit cet attribut en
 * `animation: none` sur les couches d'ambiance — exactement comme le ferait
 * `prefers-reduced-motion`.
 *
 * Valeurs du réglage :
 *   "auto" (défaut) → on laisse le navigateur décider (média-query système),
 *                     donc on N'IMPOSE PAS d'attribut.
 *   "off"           → on coupe (attribut posé).
 *   "on"            → on force l'animation (attribut retiré ; le média-query
 *                     système ne s'applique plus aux couches d'ambiance).
 *
 * Aucun rendu visuel (composant utilitaire).
 */
export function AmbientMotionGate() {
  useEffect(() => {
    const apply = (value: string) => {
      const root = document.documentElement;
      if (value === "off") root.setAttribute("data-reduce-anim", "1");
      else if (value === "on") root.setAttribute("data-anim", "force");
      else {
        // auto : on n'impose rien, le système (prefers-reduced-motion) tranche.
        root.removeAttribute("data-reduce-anim");
        root.removeAttribute("data-anim");
        return;
      }
      // "off" et "on" sont mutuellement exclusifs : on nettoie l'autre.
      if (value === "off") root.removeAttribute("data-anim");
      if (value === "on") root.removeAttribute("data-reduce-anim");
    };

    apply(readSetting(SETTING_KEYS.animations, "auto"));
    return onSettingChange((key, value) => {
      if (key === SETTING_KEYS.animations) apply(value ?? "auto");
    });
  }, []);

  return null;
}
