import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "gervifrais.com";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_CLIENT_ID!,
      clientSecret: process.env.AZURE_CLIENT_SECRET!,
      // Pas d'issuer ici — on utilise l'endpoint "common" (tous comptes Microsoft)
      // La restriction est faite dans le callback signIn ci-dessous
      authorization: {
        params: {
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
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      (session as { accessToken?: string } & typeof session).accessToken =
        token.accessToken as string | undefined;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

// Extend next-auth Session type
declare module "next-auth" {
  interface Session {
    accessToken?: string;
  }
}
