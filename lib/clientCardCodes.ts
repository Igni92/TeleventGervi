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

export interface ClientRef {
  clientId: string;
  /** Code principal du client logique (clé de regroupement). */
  primaryCode: string;
  nom: string;
}

/**
 * Mappe CHAQUE CardCode SAP (principal + secondaires) → son client logique.
 * Sert à regrouper les agrégats par cardCode sous le client (audit B5 — ex.
 * encours : « LPOI » et « LPOI. » consolidés). Source canonique `ClientCardCode`
 * si peuplée, sinon dérivation via Client.code + modes de livraison.
 */
export async function cardCodeToClientMap(): Promise<Map<string, ClientRef>> {
  const map = new Map<string, ClientRef>();
  // 1) Store canonique.
  try {
    const rows = await prisma.$queryRaw<{ cardCode: string; clientId: string; primaryCode: string; nom: string }[]>(
      Prisma.sql`SELECT cc."cardCode", cc."clientId", c."code" AS "primaryCode", c."nom"
                 FROM "ClientCardCode" cc JOIN "Client" c ON c."id" = cc."clientId"`,
    );
    if (rows.length > 0) {
      for (const r of rows) map.set(r.cardCode, { clientId: r.clientId, primaryCode: r.primaryCode, nom: r.nom });
      return map;
    }
  } catch {
    // Table absente → dérivation ci-dessous.
  }
  // 2) Dérivation : Client.code (principal) + ClientDeliveryMode.sapCardCode.
  const clients = await prisma.client.findMany({
    select: { id: true, code: true, nom: true, deliveryModes: { select: { sapCardCode: true } } },
  });
  for (const c of clients) {
    const ref: ClientRef = { clientId: c.id, primaryCode: c.code, nom: c.nom };
    map.set(c.code, ref);
    for (const m of c.deliveryModes) {
      if (m.sapCardCode && !map.has(m.sapCardCode)) map.set(m.sapCardCode, ref);
    }
  }
  return map;
}
