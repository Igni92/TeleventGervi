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

/** Forme sérialisable du scope pour les réponses API (consommée par l'UI). */
export function scopePayload(scope: AccessScope) {
  return scope.all
    ? { all: true as const }
    : { all: false as const, slpName: scope.slpName };
}
