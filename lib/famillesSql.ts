import { Prisma } from "@prisma/client";

/**
 * CTE SQL du mapping « famille effective » — **SERVEUR UNIQUEMENT**.
 *
 * `Prisma.sql` ne peut PAS s'exécuter dans le navigateur (« sqltag is unable to
 * run in this browser environment »). Ce fragment vit donc dans un module à part,
 * importé exclusivement par des routes/serveur — JAMAIS par un composant client.
 * Les données/fonctions utilisables côté client (FRUIT_FAMILIES, familyOf) restent
 * dans `lib/familles.ts`, qui doit rester SANS import Prisma.
 *
 * Les règles du CASE ci-dessous DOIVENT rester synchrones avec `familyOf`
 * (lib/familles.ts) et FRUIT_FAMILIES.
 */
export const FAMILY_CTE_SQL: Prisma.Sql = Prisma.sql`
  SELECT
    p."itemCode",
    p."itemGroup",
    p."groupName",
    p."salesUnitWeight",
    CASE
      WHEN UPPER(p."itemName") LIKE '%MYRTILLE%'  THEN 'myrtille'
      WHEN UPPER(p."itemName") LIKE '%GROSEILLE%' THEN 'groseille'
      WHEN UPPER(p."itemName") LIKE '%FRAMBOISE%' THEN 'framboise'
      WHEN UPPER(p."itemName") LIKE '%CASSIS%'    THEN 'cassis'
      WHEN UPPER(p."itemName") LIKE '%MURE%'
        OR UPPER(p."itemName") LIKE '%MÛRE%'      THEN 'mure'
      WHEN UPPER(p."itemName") LIKE '%FRAISE%'    THEN 'fraise'
      ELSE 'g_' || COALESCE(p."itemGroup"::text, 'na')
    END AS "familyKey",
    CASE
      WHEN UPPER(p."itemName") LIKE '%MYRTILLE%'  THEN 'Myrtille'
      WHEN UPPER(p."itemName") LIKE '%GROSEILLE%' THEN 'Groseille'
      WHEN UPPER(p."itemName") LIKE '%FRAMBOISE%' THEN 'Framboise'
      WHEN UPPER(p."itemName") LIKE '%CASSIS%'    THEN 'Cassis'
      WHEN UPPER(p."itemName") LIKE '%MURE%'
        OR UPPER(p."itemName") LIKE '%MÛRE%'      THEN 'Mûre'
      WHEN UPPER(p."itemName") LIKE '%FRAISE%'    THEN 'Fraise'
      ELSE COALESCE(p."groupName", 'Sans groupe')
    END AS "familyLabel"
  FROM "Product" AS p
`;
