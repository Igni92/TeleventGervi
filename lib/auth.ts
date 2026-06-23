import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "gervifrais.com";

export const { handlers, auth: _auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Derrière le proxy Vercel : on fait confiance à l'en-tête Host transmis
  // (x-forwarded-host) pour construire les URL (callback OAuth, redirections)
  // plutôt qu'une variable NEXTAUTH_URL qui peut rester sur http://localhost:3000
  // si le .env local a été collé tel quel dans Vercel. Évite les redirections
  // vers localhost en production.
  trustHost: true,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_CLIENT_ID!,
      clientSecret: process.env.AZURE_CLIENT_SECRET!,
      // Lie automatiquement la connexion Microsoft à un User EXISTANT de même
      // email (évite OAuthAccountNotLinked sur les comptes pré-existants). Sûr
      // ici : fournisseur unique de confiance (Entra, emails vérifiés) + login
      // restreint au domaine @gervifrais.com (callback signIn ci-dessous).
      allowDangerousEmailAccountLinking: true,
      // Pas d'issuer ici — on utilise l'endpoint "common" (tous comptes Microsoft)
      // La restriction est faite dans le callback signIn ci-dessous
      authorization: {
        params: {
          // Calendars.ReadWrite : rappels télévente (jeton délégué). L'envoi des
          // relances n'utilise PAS ce jeton — il passe par l'identité applicative
          // (permission d'application Mail.Send), donc pas de scope Mail.Send ici.
          scope: "openid profile email offline_access Calendars.ReadWrite User.Read",
          // Forcer le tenant spécifique au niveau de la requête d'autorisation
          tenant: process.env.AZURE_TENANT_ID,
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user }) {
      // Restreindre la connexion aux comptes @gervifrais.com uniquement
      const email = user.email ?? "";
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return false; // Refuse la connexion
      }
      return true;
    },
    async jwt({ token, account }) {
      // Le jeton Microsoft (Graph) reste UNIQUEMENT dans le JWT chiffré (cookie
      // httpOnly), jamais recopié dans la session renvoyée au navigateur via
      // /api/auth/session. Les routes serveur le relisent via getToken()
      // (cf. app/api/reminders/route.ts) — pas de fuite côté client.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      return token;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

/**
 * ⚠️ MODE TEST (préversion uniquement) — bypass TEMPORAIRE du login Microsoft.
 *
 * Activé EXCLUSIVEMENT quand `VERCEL_ENV === "preview"` (déploiements de
 * préversion = branches). JAMAIS en production (`VERCEL_ENV === "production"`)
 * ni en local. Permet de tester l'UI (mobile) sans SSO. À RETIRER une fois les
 * tests terminés.
 *
 * En mode test, `auth()` (sans argument, server components/routes) renvoie une
 * session factice. Les autres signatures (middleware) passent au vrai handler ;
 * le middleware (proxy.ts) court-circuite la redirection login en préversion.
 */
const TEST_NO_AUTH = process.env.VERCEL_ENV === "preview";

// Email admin (cf. ADMIN_EMAILS) → la préversion voit les données réelles
// (sinon périmètre vide = 0 client / 0 encours). Préversion uniquement.
const FAKE_SESSION = {
  user: { name: "Test (préversion)", email: "m.mandine@gervifrais.com" },
  expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

export const auth = ((...args: unknown[]) => {
  if (TEST_NO_AUTH && args.length === 0) {
    return Promise.resolve(FAKE_SESSION);
  }
  return (_auth as (...a: unknown[]) => unknown)(...args);
}) as unknown as typeof _auth;

// Le jeton d'accès Graph vit dans le JWT (server-only), PAS dans la Session
// exposée au client. Typage du JWT pour getToken()/le callback jwt.
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}
