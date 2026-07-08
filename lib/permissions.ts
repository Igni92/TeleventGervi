import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { initialsFromEmail } from "@/lib/salespeople";

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

/** Emails à accès global « bootstrap » (admin système indélogeable, insensible à
 *  la casse). Garde-fou anti-lock-out : ne jamais vider cette liste.
 *  NB : seul l'ADMIN garde un rôle « système » codé en dur (cf. demande métier) —
 *  la direction et les préparateurs sont désignés en base depuis l'écran Effectifs. */
export const ADMIN_EMAILS = [
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
    // Une requête : flags admin/direction (User) + rattachement commercial (slpName).
    // Accès global = admin OU direction (la direction voit tout comme un admin ;
    // seules deux actions lui sont fermées — cf. requireStrictAdmin).
    const rows = await prisma.$queryRawUnsafe<{ isAdmin: boolean | null; isDirection: boolean | null; slpName: string | null }[]>(
      `SELECT u."isAdmin" AS "isAdmin", u."isDirection" AS "isDirection", uc."slpName" AS "slpName"
       FROM "User" u
       LEFT JOIN "UserCommercial" uc ON LOWER(uc."email") = LOWER(u."email")
       WHERE LOWER(u."email") = $1 LIMIT 1`,
      email,
    );
    const row = rows[0];
    if (row?.isAdmin || row?.isDirection) return { all: true, email };
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

/**
 * Trigramme SAP (slpName) du commercial CONNECTÉ — **indépendant du flag admin**.
 *
 * `getAccessScope` court-circuite les admins (`{ all: true }`) sans résoudre leur
 * slpName : pour les écrans transverses (dashboard, pilotage) un admin n'est pas
 * filtré. Mais la **console d'appel** est un poste de travail PERSONNEL — même un
 * admin n'y voit que SES clients (vendeur = son trigramme). On résout donc le
 * trigramme depuis l'email : mapping `UserCommercial` d'abord, repli sur la liste
 * statique `SALESPEOPLE`. `null` = email inconnu/non mappé (→ console vide).
 */
export async function getOwnSlpName(session: Session | null): Promise<string | null> {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return null;
  try {
    const rows = await prisma.$queryRawUnsafe<{ slpName: string }[]>(
      `SELECT "slpName" FROM "UserCommercial" WHERE LOWER("email") = $1 LIMIT 1`,
      email,
    );
    if (rows[0]?.slpName) return rows[0].slpName;
  } catch {
    /* table UserCommercial absente → repli sur la liste statique */
  }
  return initialsFromEmail(email);
}

/** True si la session a l'accès global (admin bootstrap OU promu en base OU
 *  DIRECTION). À utiliser pour gater les écrans/actions « management » (vision
 *  globale, gestion d'équipe, validation d'inventaire…). */
export async function requireAdmin(session: Session | null): Promise<boolean> {
  return (await getAccessScope(session)).all;
}

/** True UNIQUEMENT si l'utilisateur est DIRECTION (flag DB `isDirection`) —
 *  DISTINCT d'admin. Sert à réserver à la seule direction certaines actions/
 *  notifications (ex. validation mensuelle des heures) sans les ouvrir aux admins.
 *  Un admin « bootstrap » (ADMIN_EMAILS) n'est PAS direction. */
export async function isDirection(session: Session | null): Promise<boolean> {
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return false;
  try {
    const rows = await prisma.$queryRawUnsafe<{ isDirection: boolean | null }[]>(
      `SELECT "isDirection" FROM "User" WHERE LOWER("email") = $1 LIMIT 1`,
      email,
    );
    return !!rows[0]?.isDirection;
  } catch {
    return false;
  }
}

/** Emails de la DIRECTION (flag DB `isDirection`) — cible « employeur » des
 *  notifications de validation des heures. */
export async function directionEmails(): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ email: string | null }[]>(
      `SELECT "email" FROM "User" WHERE "isDirection" = true`,
    );
    return rows.map((r) => r.email?.trim().toLowerCase()).filter((e): e is string => !!e);
  } catch {
    return [];
  }
}

/**
 * True si la session est admin/direction (cf. requireAdmin) OU si l'utilisateur
 * est PRÉPARATEUR (User.isPreparateur = true). Palier dédié aux écritures de la
 * chaîne fournisseur / stock (réception d'une commande, annulation d'une entrée
 * marchandise, modification/annulation d'une commande fournisseur) : ces actions
 * appartiennent à l'entrepôt — un commercial pur n'y a pas accès, mais le
 * préparateur si. Lecture défensive (repli sur false si la colonne manque).
 */
export async function requirePreparateurOrAdmin(session: Session | null): Promise<boolean> {
  if (await requireAdmin(session)) return true;
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return false;
  try {
    const rows = await prisma.$queryRawUnsafe<{ isPreparateur: boolean | null }[]>(
      `SELECT "isPreparateur" FROM "User" WHERE LOWER("email") = $1 LIMIT 1`,
      email,
    );
    return !!rows[0]?.isPreparateur;
  } catch {
    return false;
  }
}

/**
 * True si l'utilisateur connecté porte le rôle LIVREUR (accès restreint :
 * livraison + fiche client logistique). Lecture défensive (repli false si la
 * colonne manque). Immédiat (relit la base à chaque appel — pas de cache session).
 */
export async function isLivreur(session: Session | null): Promise<boolean> {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return false;
  try {
    const rows = await prisma.$queryRawUnsafe<{ isLivreur: boolean | null }[]>(
      `SELECT "isLivreur" FROM "User" WHERE LOWER("email") = $1 LIMIT 1`,
      email,
    );
    return !!rows[0]?.isLivreur;
  } catch {
    return false;
  }
}

/**
 * True si l'utilisateur connecté porte le rôle AGRÉEUR. L'agréeur a un droit
 * UNIQUE : « passer » une commande fournisseur en entrée marchandise (réception
 * → PurchaseDeliveryNote). Il ne peut créer NI une commande fournisseur NI une
 * entrée marchandise (cf. requireCanReceivePurchaseOrder + les routes de création
 * qui bloquent un agréeur « pur »). Lecture défensive (repli false si la colonne
 * manque). Immédiat (relit la base à chaque appel — pas de cache session).
 */
export async function isAgreeur(session: Session | null): Promise<boolean> {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return false;
  try {
    const rows = await prisma.$queryRawUnsafe<{ isAgreeur: boolean | null }[]>(
      `SELECT "isAgreeur" FROM "User" WHERE LOWER("email") = $1 LIMIT 1`,
      email,
    );
    return !!rows[0]?.isAgreeur;
  } catch {
    return false;
  }
}

/**
 * True si la session peut RÉCEPTIONNER une commande fournisseur (la « passer » en
 * entrée marchandise) : préparateur OU admin/direction (requirePreparateurOrAdmin)
 * OU AGRÉEUR. C'est le SEUL geste de la chaîne fournisseur ouvert à l'agréeur —
 * la création (commande / entrée) et les autres écritures (annulation, modif)
 * restent réservées à la préparation / l'administration.
 */
export async function requireCanReceivePurchaseOrder(session: Session | null): Promise<boolean> {
  if (await requirePreparateurOrAdmin(session)) return true;
  return await isAgreeur(session);
}

/**
 * True UNIQUEMENT pour un administrateur (bootstrap ADMIN_EMAILS OU User.isAdmin) —
 * la DIRECTION en est exclue. Réservé aux deux actions que seul l'admin maîtrise :
 *   1. basculer la base SAP prod ↔ test (/api/sap/environment) ;
 *   2. promouvoir / rétrograder le rôle ADMIN d'un compte.
 * Tout le reste passe par `requireAdmin` (admin OU direction).
 */
export async function requireStrictAdmin(session: Session | null): Promise<boolean> {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return false;
  if (ADMIN_EMAILS.some((a) => a.toLowerCase() === email)) return true;
  try {
    const rows = await prisma.$queryRawUnsafe<{ isAdmin: boolean | null }[]>(
      `SELECT "isAdmin" FROM "User" WHERE LOWER("email") = $1 LIMIT 1`,
      email,
    );
    return !!rows[0]?.isAdmin;
  } catch {
    return false;
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

/** True si le client rattaché à un CardCode SAP est dans le périmètre.
 *  Admin → true. Sinon match Client.code = cardCode OU un ClientDeliveryMode
 *  pointant ce cardCode, ET (commercial = slpName OU vendeur = slpName).
 *  Empêche l'IDOR sur les routes SAP indexées par cardCode/docEntry. */
export async function cardCodeInScope(scope: AccessScope, cardCode: string | null | undefined): Promise<boolean> {
  if (scope.all) return true;
  if (!scope.slpName || !cardCode) return false;
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT 1 AS n FROM "Client" c
     WHERE (c."commercial" = $2 OR c."vendeur" = $2)
       AND (c."code" = $1 OR EXISTS (
         SELECT 1 FROM "ClientDeliveryMode" dm
         WHERE dm."clientId" = c."id" AND dm."sapCardCode" = $1))
     LIMIT 1`,
    cardCode, scope.slpName,
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
