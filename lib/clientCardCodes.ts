import { prisma } from "@/lib/prisma";

/**
 * CardCodes SAP d'un client logique — SOURCE UNIQUE (audit B5, 1er pas).
 *
 * Un client TeleVent peut avoir plusieurs comptes SAP : son code principal
 * (`Client.code`) + les codes secondaires portés par ses modes de livraison
 * (`ClientDeliveryMode.sapCardCode`, ex. livraison directe vs via plateforme).
 * Cette logique était recopiée à l'identique dans plusieurs routes — on la
 * centralise ici (dédoublonnée, ordre stable : principal d'abord).
 *
 * NB : socle pour le chantier B5 (cf. docs/chantiers-b4-b5.md). Une table
 * `ClientCardCode` dédiée pourra remplacer la dérivation via les modes de
 * livraison sans changer cette signature.
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

/** Version requête (callers n'ayant que l'id). `[]` si client introuvable. */
export async function cardCodesForClient(clientId: string): Promise<string[]> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { code: true, deliveryModes: { select: { sapCardCode: true } } },
  });
  return client ? cardCodesOf(client) : [];
}
