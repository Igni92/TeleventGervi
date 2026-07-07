import NextAuth, { type DefaultSession } from "next-auth";
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
    async jwt({ token, account, user }) {
      // Le jeton Microsoft (Graph) reste UNIQUEMENT dans le JWT chiffré (cookie
      // httpOnly), jamais recopié dans la session renvoyée au navigateur via
      // /api/auth/session. Les routes serveur le relisent via getToken()
      // (cf. app/api/reminders/route.ts) — pas de fuite côté client.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      // Rôles LIVREUR + AGRÉEUR portés dans le jeton pour le verrou middleware
      // (Edge, sans accès base). Résolus à la connexion. DÉFENSIF : toute erreur
      // est avalée → jamais bloquant pour le login (au pire, pas de verrou).
      // L'agréeur doit garder l'accès aux Commandes fournisseurs / Entrées
      // marchandises (réception CF → EM) MÊME s'il est aussi préparateur/livreur.
      if (user?.email) {
        try {
          const rows = await prisma.$queryRawUnsafe<{ isLivreur: boolean | null; isAgreeur: boolean | null }[]>(
            `SELECT "isLivreur", "isAgreeur" FROM "User" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
            user.email,
          );
          token.isLivreur = !!rows[0]?.isLivreur;
          token.isAgreeur = !!rows[0]?.isAgreeur;
        } catch { /* colonne absente / base indispo → pas de verrou (login OK) */ }
      }
      return token;
    },
    async session({ session, token }) {
      // Expose les rôles livreur + agréeur au middleware (req.auth.user.*) et aux
      // composants. N'altère rien d'autre de la session.
      if (session.user) {
        session.user.isLivreur = token.isLivreur === true;
        session.user.isAgreeur = token.isAgreeur === true;
      }
      return session;
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
  user: { name: "Test (préversion)", email: "m.mandine@gervifrais.com", isLivreur: false, isAgreeur: false },
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
    isLivreur?: boolean;
    isAgreeur?: boolean;
  }
}

// Champs de rôle exposés dans la session (lus par le middleware et les composants).
declare module "next-auth" {
  interface Session {
    user: {
      isLivreur?: boolean;
      isAgreeur?: boolean;
    } & DefaultSession["user"];
  }
}
