"use client";

import { signOut } from "next-auth/react";

/** Sortie de secours de l'écran de bienvenue : un compte non habilité n'a ni
 *  barre latérale ni menu, il n'aurait aucun moyen de se déconnecter (utile si
 *  quelqu'un s'est connecté avec le mauvais compte). */
export function SignOutLink() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-[12px] font-medium text-white/40 hover:text-white/70 transition-colors"
    >
      Se déconnecter
    </button>
  );
}
