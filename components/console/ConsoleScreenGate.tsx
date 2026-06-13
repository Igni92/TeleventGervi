"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * C3 — Mémoire de l'écran Console.
 *
 * Problème réel : l'Écran 2 vit sur /console/ecran2 (fenêtre détachée via
 * window.open depuis la Console 1, OU même onglet posé sur le 2ᵉ écran
 * physique). Quand on quitte la Console puis qu'on clique « Console » dans la
 * sidebar, on retombe systématiquement sur /console (Écran 1) alors qu'on
 * travaillait sur l'Écran 2.
 *
 * Solution : chaque écran enregistre son passage —
 *   • localStorage  `televente:lastConsoleScreen` : mémoire durable, partagée
 *     entre fenêtres (survit au redémarrage du navigateur) ;
 *   • sessionStorage (même clé) : mémoire PAR FENÊTRE, prioritaire — la
 *     fenêtre « Écran 1 » d'un poste dual-screen ne se fait pas détourner
 *     vers l'Écran 2 simplement parce que le popup a écrit dans le
 *     localStorage commun.
 *
 * À l'arrivée sur /console (écran par défaut), le Gate relit la mémoire et
 * redirige côté client via router.replace — early return null pendant la
 * redirection, donc aucun flash de l'Écran 1.
 *
 * Retour volontaire à l'Écran 1 depuis l'Écran 2 : lien « Écran 1 » du bandeau
 * (app/console/ecran2/page.tsx) qui appelle rememberConsoleScreen("ecran1")
 * avant de naviguer.
 */

const KEY = "televente:lastConsoleScreen";

export type ConsoleScreen = "ecran1" | "ecran2";

/** Enregistre l'écran consulté (appelé au mount de chaque écran Console). */
export function rememberConsoleScreen(screen: ConsoleScreen) {
  try { localStorage.setItem(KEY, screen); } catch { /* ignore */ }
  try { sessionStorage.setItem(KEY, screen); } catch { /* ignore */ }
}

export function ConsoleScreenGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [stay, setStay] = useState(false);

  useEffect(() => {
    let last: string | null = null;
    try {
      last = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    } catch { /* stockage indisponible → comportement historique (Écran 1) */ }
    if (last === "ecran2") {
      router.replace("/console/ecran2");
      return; // on reste sur null → pas de flash de l'Écran 1
    }
    rememberConsoleScreen("ecran1");
    setStay(true);
  }, [router]);

  if (!stay) return null;
  return <>{children}</>;
}
