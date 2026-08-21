import NextAuth, { type DefaultSession } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { ADMIN_EMAILS } from "@/lib/permissions";
import { isRestrictedPreparateur } from "@/lib/preparateur";

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
      // Rôles LIVREUR + AGRÉEUR portés dans le jeton pour le verrou middleware.
      // Résolus à la connexion PUIS re-résolus périodiquement (TTL) : figés au
      // seul sign-in, un rôle coché en base APRÈS coup (ex. passer un préparateur
      // agréeur) n'apparaissait JAMAIS tant que l'utilisateur ne se reconnectait
      // pas — or les téléphones d'entrepôt gardent leur session des semaines
      // (PWA, cookie 30 j) : l'agréeur ne voyait pas ses Commandes fournisseurs.
      // proxy.ts (Next 16) tourne en runtime Node → l'accès Prisma est permis ici ;
      // le TTL borne le coût à ~1 requête par utilisateur toutes les 5 minutes.
      // DÉFENSIF : toute erreur est avalée → jamais bloquant pour le login.
      //
      // ⚠️ Un ADMIN / DIRECTION garde un accès COMPLET : il n'est JAMAIS confiné
      // par un rôle terrain, même s'il porte aussi le flag livreur/agréeur (sinon
      // il boucle sur /commandes-fournisseurs). Ces flags ne servent QU'AU verrou
      // middleware → on les neutralise pour les privilégiés (grâce au TTL, le
      // correctif s'applique en ≤ 5 min sans reconnexion).
      const ROLES_TTL_MS = 5 * 60_000;
      const email = user?.email ?? (typeof token.email === "string" ? token.email : null);
      const rolesStale =
        typeof token.rolesAt !== "number" || Date.now() - token.rolesAt > ROLES_TTL_MS;
      // Un token qui PORTE ENCORE un flag terrain est re-validé À CHAQUE requête
      // (pas seulement au TTL) : un admin promu APRÈS l'émission de son jeton, ou
      // dont le jeton précède la neutralisation des privilégiés, était confiné
      // jusqu'à ~5 min OU une reconnexion (cas Lyse GUNSLAY, admin+livreur+agréeur,
      // bloquée hors /inventaire sur mobile). Coût borné : seuls les jetons
      // « terrain » re-requêtent, et ils sont rares (téléphones d'entrepôt).
      const looksConfined = token.isLivreur === true || token.isAgreeur === true;
      if (email && (user?.email || rolesStale || looksConfined)) {
        try {
          const rows = await prisma.$queryRawUnsafe<{
            isLivreur: boolean | null; isAgreeur: boolean | null; isAdmin: boolean | null;
            isDirection: boolean | null; isPreparateur: boolean | null; slpName: string | null;
          }[]>(
            `SELECT u."isLivreur", u."isAgreeur", u."isAdmin", u."isDirection", u."isPreparateur",
                    uc."slpName" AS "slpName"
               FROM "User" u
               LEFT JOIN "UserCommercial" uc ON LOWER(uc."email") = LOWER(u."email")
              WHERE LOWER(u."email") = LOWER($1) LIMIT 1`,
            email,
          );
          const r = rows[0];
          const bootstrap = ADMIN_EMAILS.some((a) => a.toLowerCase() === email.toLowerCase());
          const privileged = !!r?.isAdmin || !!r?.isDirection || bootstrap;
          // Porté sur le jeton → le middleware ET la nav mobile exemptent
          // explicitement les privilégiés du confinement terrain (défense en
          // profondeur : même si un flag terrain traînait, un admin n'est jamais
          // enfermé).
          token.privileged = privileged;
          token.isLivreur = !privileged && !!r?.isLivreur;
          token.isAgreeur = !privileged && !!r?.isAgreeur;

          // ── COMPTE PAS ENCORE HABILITÉ ────────────────────────────────────
          // Le domaine @gervifrais.com suffit à se connecter : n'importe quelle
          // recrue obtient donc une session dès son premier login. Sans ce
          // verrou elle atterrissait avec un accès COMPLET, car `isCommercial`
          // vaut `true` PAR DÉFAUT en base — ce flag ne peut donc pas servir de
          // preuve d'habilitation.
          //
          // Habilité = au moins un rôle EXPLICITEMENT posé (admin, direction,
          // préparateur, livreur, agréeur) OU un rattachement commercial
          // (UserCommercial.slpName), qui est ce qui rend un commercial
          // réellement opérant. Tout le reste → écran de bienvenue seul.
          //
          // isRestrictedPreparateur (liste d'emails, hors base) est vérifié
          // aussi : un préparateur désigné par email est habilité même si le
          // flag base n'a jamais été coché.
          token.provisioned = privileged
            || !!r?.isPreparateur || !!r?.isLivreur || !!r?.isAgreeur
            || !!r?.slpName
            || isRestrictedPreparateur(email);
          token.rolesAt = Date.now();
        } catch {
          // Colonne absente / base indisponible → on NE POSE AUCUN verrou (login
          // OK). Volontairement permissif : un incident base ne doit pas
          // enfermer toute l'entreprise sur l'écran de bienvenue.
          token.provisioned = true;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Expose les rôles livreur + agréeur au middleware (req.auth.user.*) et aux
      // composants. N'altère rien d'autre de la session.
      if (session.user) {
        // ⚠️ En stratégie JWT, Auth.js ne construit `session.user` qu'avec
        // { name, email, image } — l'ID N'EST PAS exposé par défaut. Sans cette
        // ligne, toute route qui vérifie `session.user.id` renvoie 401 :
        // abonnement push (/api/push/subscribe), prises de clients temporaires
        // (/api/temp-assignments), claims console… `token.sub` = id User (adapter).
        if (token.sub) session.user.id = token.sub;
        session.user.isLivreur = token.isLivreur === true;
        session.user.isAgreeur = token.isAgreeur === true;
        // Privilégié (admin/direction) → jamais confiné : lu par le middleware et
        // isTerrainConfined pour exempter explicitement, quoi qu'il arrive.
        session.user.privileged = token.privileged === true;
        // `!== false` : un jeton émis AVANT ce champ (session déjà ouverte, PWA
        // gardée des semaines) n'a pas la clé — on ne l'enferme pas d'office,
        // le TTL des rôles la posera à la prochaine résolution.
        session.user.provisioned = token.provisioned !== false;
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
    /** Admin/direction → jamais confiné par un rôle terrain (cf. proxy.ts). */
    privileged?: boolean;
    /** Compte HABILITÉ : au moins un rôle posé ou un rattachement commercial.
     *  Faux = accès au seul écran de bienvenue (cf. proxy.ts). */
    provisioned?: boolean;
    /** Dernière résolution des rôles en base (epoch ms) — pilote le TTL. */
    rolesAt?: number;
  }
}

// Champs de rôle exposés dans la session (lus par le middleware et les composants).
declare module "next-auth" {
  interface Session {
    user: {
      isLivreur?: boolean;
      isAgreeur?: boolean;
      /** Admin/direction → exempté du confinement terrain. */
      privileged?: boolean;
      /** Faux = compte connecté mais sans aucun rôle attribué. */
      provisioned?: boolean;
    } & DefaultSession["user"];
  }
}
