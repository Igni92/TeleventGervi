import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

/**
 * Gestion des droits — « par défaut, un commercial ne voit que ses propres
 * données ». Exception : les emails admin ci-dessous voient TOUT.
 *
 * Le rattachement compte ↔ commercial SAP vit dans la table `UserCommercial`
 * (email → slpName, cf. scripts/ddl-user-commercial.mjs). Un compte connecté
 * mais non mappé n'a accès à AUCUNE donnée : les écrans affichent alors
 * `UNMAPPED_MESSAGE`.
 *
 * Table hors client Prisma typé (generate bloqué) → accès en $queryRawUnsafe.
 *
 *   model UserCommercial {
 *     email     String   @id
 *     slpName   String
 *     createdAt DateTime @default(now())
 *   }
 */

/** Emails à accès global (comparaison insensible à la casse). */
export const ADMIN_EMAILS = [
  "jm.gunslay@gervifrais.com",
  "m.mandine@gervifrais.com",
] as const;

/** Message UI standard pour un compte non relié à un commercial. */
export const UNMAPPED_MESSAGE =
  "Compte non relié à un commercial — contactez l'administrateur.";

export type AccessScope =
  /** Admin : accès global, aucun filtre. */
  | { all: true; email: string }
  /** Commercial : ne voit que les données de `slpName`. `null` = compte non
   *  mappé → aucune donnée (les routes renvoient des listes vides + message). */
  | { all: false; slpName: string | null; email: string | null };

/** Résout le périmètre d'accès depuis la session next-auth.
 *  Admin si : email bootstrap (ADMIN_EMAILS) OU User.isAdmin = true en base
 *  (rôle promu depuis l'UI). Sinon scopé sur le slpName (UserCommercial). */
export async function getAccessScope(session: Session | null): Promise<AccessScope> {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return { all: false, slpName: null, email: null };

  // Admins « bootstrap » indélogeables (sécurité : jamais de lock-out).
  if (ADMIN_EMAILS.some((a) => a.toLowerCase() === email)) {
    return { all: true, email };
  }

  try {
    // Une requête : flag admin (User.isAdmin) + rattachement commercial (slpName).
    const rows = await prisma.$queryRawUnsafe<{ isAdmin: boolean | null; slpName: string | null }[]>(
      `SELECT u."isAdmin" AS "isAdmin", uc."slpName" AS "slpName"
       FROM "User" u
       LEFT JOIN "UserCommercial" uc ON LOWER(uc."email") = LOWER(u."email")
       WHERE LOWER(u."email") = $1 LIMIT 1`,
      email,
    );
    const row = rows[0];
    if (row?.isAdmin) return { all: true, email };
    return { all: false, slpName: row?.slpName ?? null, email };
  } catch {
    // Colonne User.isAdmin pas encore créée (DDL non exécutée) → repli sur le
    // mapping UserCommercial seul (pas d'admins DB tant que la colonne manque).
    try {
      const rows = await prisma.$queryRawUnsafe<{ slpName: string }[]>(
        `SELECT "slpName" FROM "UserCommercial" WHERE LOWER("email") = $1 LIMIT 1`,
        email,
      );
      return { all: false, slpName: rows[0]?.slpName ?? null, email };
    } catch {
      return { all: false, slpName: null, email };
    }
  }
}

/** True si la session a l'accès global (admin bootstrap OU promu en base).
 *  Version asynchrone à utiliser dans les routes/pages pour gater une action
 *  admin — remplace l'ancien `isAdmin` synchrone (qui ne voyait pas les admins
 *  promus en base). */
export async function requireAdmin(session: Session | null): Promise<boolean> {
  return (await getAccessScope(session)).all;
}

/**
 * Filtre `slpName` pour les agrégats pilotage (lib/pilotage) :
 *   - admin               → `null`  (vision globale, AUCUN filtre)
 *   - commercial mappé    → son `slpName`
 *   - commercial NON mappé → sentinel impossible → les agrégats renvoient 0
 *     (jamais la vision globale : on ne fuit rien à un compte non relié).
 */
export function pilotageSlpFilter(scope: AccessScope): string | null {
  if (scope.all) return null;
  return scope.slpName || "__UNMAPPED__";
}

/**
 * Résout la vue pilotage d'une requête, impersonation « voir comme » comprise.
 *   - admin + ?as=MM  → aperçu filtré sur MM (lecture seule), vues transverses
 *                       MASQUÉES (l'admin voit ce que MM verrait).
 *   - admin seul      → vision globale, vues transverses visibles.
 *   - commercial      → son propre slpName (le ?as= est IGNORÉ — anti-contournement).
 *   - non mappé       → sentinel impossible → résultats à zéro.
 */
export function resolvePilotageView(scope: AccessScope, asParam: string | null): {
  slp: string | null;
  viewingAs: string | null;
  showTransverse: boolean;
} {
  const impersonate = scope.all && asParam?.trim() ? asParam.trim() : null;
  return {
    slp: impersonate ?? pilotageSlpFilter(scope),
    viewingAs: impersonate,
    showTransverse: scope.all && !impersonate,
  };
}

/**
 * Vérifie qu'un client (par `id`) est dans le périmètre d'accès :
 *   - admin                       → toujours `true`
 *   - commercial mappé            → `true` si Client.commercial = slpName OU
 *                                    Client.vendeur = slpName
 *   - non mappé / client absent   → `false`
 *
 * Empêche l'IDOR sur les routes /api/clients/[id]/* (un commercial ne doit pas
 * lire/modifier la fiche, les contacts, la compta… d'un client d'un collègue).
 * `vendeur` n'est pas dans le client Prisma typé → lecture raw SQL (idem
 * /api/clients qui scope la liste de la même façon).
 */
export async function clientInScope(scope: AccessScope, clientId: string): Promise<boolean> {
  if (scope.all) return true;
  if (!scope.slpName) return false;
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT 1 AS n FROM "Client" WHERE "id" = $1 AND ("commercial" = $2 OR "vendeur" = $2) LIMIT 1`,
    clientId,
    scope.slpName,
  );
  return rows.length > 0;
}

/**
 * Liste des `id` de clients du périmètre (Client.commercial OU Client.vendeur =
 * slpName) — pour restreindre les LISTES CRM (appels/rappels/incidents) d'un
 * non-admin. `null` = admin (aucune restriction) ; non mappé → `[]` (liste vide).
 */
export async function clientIdsInScope(scope: AccessScope): Promise<string[] | null> {
  if (scope.all) return null;
  if (!scope.slpName) return [];
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "Client" WHERE "commercial" = $1 OR "vendeur" = $1`,
    scope.slpName,
  );
  return rows.map((r) => r.id);
}

/** Forme sérialisable du scope pour les réponses API (consommée par l'UI). */
export function scopePayload(scope: AccessScope) {
  return scope.all
    ? { all: true as const }
    : { all: false as const, slpName: scope.slpName };
}
