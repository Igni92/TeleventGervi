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

/**
 * True si la session correspond à un email admin (accès global). Synchrone : les
 * admins sont déterminés par email seul (aucun accès DB) — à utiliser pour
 * verrouiller les routes/actions réservées aux administrateurs (imports, resync,
 * (ré)assignation de portefeuille, gestion d'équipe…).
 */
export function isAdmin(session: Session | null): boolean {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  return !!email && ADMIN_EMAILS.some((a) => a.toLowerCase() === email);
}

/** Message UI standard pour un compte non relié à un commercial. */
export const UNMAPPED_MESSAGE =
  "Compte non relié à un commercial — contactez l'administrateur.";

export type AccessScope =
  /** Admin : accès global, aucun filtre. */
  | { all: true; email: string }
  /** Commercial : ne voit que les données de `slpName`. `null` = compte non
   *  mappé → aucune donnée (les routes renvoient des listes vides + message). */
  | { all: false; slpName: string | null; email: string | null };

/** Résout le périmètre d'accès depuis la session next-auth. */
export async function getAccessScope(session: Session | null): Promise<AccessScope> {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return { all: false, slpName: null, email: null };

  if (ADMIN_EMAILS.some((a) => a.toLowerCase() === email)) {
    return { all: true, email };
  }

  try {
    const rows = await prisma.$queryRawUnsafe<{ slpName: string }[]>(
      `SELECT "slpName" FROM "UserCommercial" WHERE LOWER("email") = $1 LIMIT 1`,
      email,
    );
    return { all: false, slpName: rows[0]?.slpName ?? null, email };
  } catch {
    // Table absente (DDL pas encore exécutée) → comportement sûr : aucune donnée.
    return { all: false, slpName: null, email };
  }
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
