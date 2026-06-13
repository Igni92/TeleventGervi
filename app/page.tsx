import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * « / » → l'accueil hub (/accueil) pour les sessions ouvertes, /login sinon.
 * Le hub vit sous /accueil pour profiter du layout applicatif (sidebar) et
 * d'un loading.tsx de section — « / » reste une simple porte d'entrée.
 */
export default async function HomePage() {
  const session = await auth();

  if (session) {
    redirect("/accueil");
  } else {
    redirect("/login");
  }
}
