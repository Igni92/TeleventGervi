"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  applyHoverContrast, hoverContrastKey, onSettingChange, readSetting,
} from "@/components/settings/app-settings";

/**
 * Applique, sur TOUTE l'app, le contraste de surbrillance au survol choisi par
 * l'utilisateur connecté (réglage propre à la session — cf. /parametres).
 *
 * Monté dans Providers (sous SessionProvider) : dès que l'identité de session
 * est connue, on lit la valeur PROPRE à cet utilisateur et on la pose sur
 * <html>. Aucun risque de FOUC : le contraste ne concerne que l'état :hover,
 * invisible au chargement. Réagit à chaud aux changements (même onglet via
 * CustomEvent, autres onglets via `storage`).
 */
export function HoverContrastGate() {
  const { data: session } = useSession();
  const user = session?.user?.email ?? null;

  useEffect(() => {
    const key = hoverContrastKey(user);
    const apply = () => {
      const raw = readSetting(key, "");
      const n = raw === "" ? null : Number(raw);
      applyHoverContrast(n != null && Number.isFinite(n) ? n : null);
    };
    apply();
    // Suit les écritures de la page Paramètres (clé suffixée par l'utilisateur).
    return onSettingChange((k) => { if (k === key) apply(); });
  }, [user]);

  return null;
}
