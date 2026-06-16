import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * CardCodes SAP d'un client logique — SOURCE UNIQUE (audit B5).
 *
 * Un client TeleVent peut avoir plusieurs comptes SAP : son code principal
 * (`Client.code`) + des comptes secondaires (ex. livraison directe vs via
 * plateforme — `ClientDeliveryMode.sapCardCode`).
 *
 * Source canonique = la table `ClientCardCode` (store explicite). Tant qu'elle
 * n'est pas peuplée (migration `scripts/ddl-client-cardcodes.mjs` non appliquée),
 * on **replie** sur la dérivation via les modes de livraison → comportement
 * identique. Ordre stable : principal d'abord.
 */

type ClientWithModes = {
  code: string;
  deliveryModes: { sapCardCode: string }[];
};

/** Version pure (callers ayant déjà chargé la relation `deliveryModes`). */
export function cardCodesOf(client: ClientWithModes): string[] {
  return Array.from(
    new Set<string>([client.code, ...client.deliveryModes.map((m) => m.sapCardCode).filter(Boolean)]),
  );
}

/**
 * Version requête (callers n'ayant que l'id). Lit `ClientCardCode` si présent,
 * sinon dérive via les modes de livraison. `[]` si client introuvable.
 */
export async function cardCodesForClient(clientId: string): Promise<string[]> {
  // 1) Store canonique (audit B5) si la table existe et contient ce client.
  try {
    const rows = await prisma.$queryRaw<{ cardCode: string }[]>(
      Prisma.sql`SELECT "cardCode" FROM "ClientCardCode"
                 WHERE "clientId" = ${clientId}
                 ORDER BY "isPrimary" DESC, "createdAt" ASC`,
    );
    if (rows.length > 0) {
      return Array.from(new Set(rows.map((r) => r.cardCode).filter(Boolean)));
    }
  } catch {
    // Table absente (migration non appliquée) → repli ci-dessous.
  }
  // 2) Repli : dérivation via les modes de livraison (comportement historique).
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { code: true, deliveryModes: { select: { sapCardCode: true } } },
  });
  return client ? cardCodesOf(client) : [];
}
