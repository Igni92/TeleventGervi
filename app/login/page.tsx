import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginButton } from "./LoginButton";
import { Logo } from "@/components/Logo";
import { Banner } from "@/components/ui/banner";

export const metadata = { title: "Connexion | Gervi" };

/**
 * Écran de connexion — porte d'entrée UNIQUE de l'application.
 *
 * Minimal et calme : fond token --background, carte centrée bg-card
 * rounded-2xl shadow-card, logo sobre, un seul bouton SSO. Aucun décor.
 *
 * Cible post-login unifiée sur /accueil (comme la racine app/page.tsx) ;
 * le paramètre ?callbackUrl posé par le middleware (proxy.ts) reste
 * honoré par LoginButton pour revenir sur la page demandée.
 */

/** Messages d'erreur NextAuth (pages.error pointe ici avec ?error=…). */
function errorMessage(code: string): string {
  if (code === "AccessDenied") {
    return "Accès réservé aux comptes Gervifrais. Connectez-vous avec votre adresse professionnelle.";
  }
  return "La connexion a échoué. Veuillez réessayer.";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/accueil");

  const { error } = await searchParams;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[380px] animate-fade-up">
        <div className="rounded-2xl bg-card shadow-card p-8">
          {/* Identité */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <Logo className="h-14 w-14" />
            <div className="text-center">
              <h1 className="text-title2 font-bold text-foreground">Gervi</h1>
              <p className="text-body text-muted-foreground mt-1">
                Gestion télévente
              </p>
            </div>
          </div>

          {/* Erreur d'authentification (NextAuth renvoie ici avec ?error=…) */}
          {error && (
            <Banner tone="danger" className="mb-5">
              {errorMessage(error)}
            </Banner>
          )}

          <LoginButton />

          <p className="text-center text-caption text-muted-foreground mt-5">
            Accès réservé à l&apos;équipe Gervifrais.
            <br />
            Authentification sécurisée via Microsoft 365.
          </p>
        </div>

        <p className="text-center text-caption2 text-muted-foreground/70 mt-5">
          &copy; {new Date().getFullYear()} Gervi
        </p>
      </div>
    </div>
  );
}
