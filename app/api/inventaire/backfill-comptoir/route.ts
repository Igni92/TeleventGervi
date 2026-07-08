import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { getAccessScope } from "@/lib/permissions";
import { isPreparateur, getDeliveryStatuses, markComptoirDelivered } from "@/lib/inventory";
import { isComptoirClient } from "@/lib/segments";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventaire/backfill-comptoir
 *
 * Régularisation en masse des VENTES COMPTOIR de l'EXISTANT : marque toutes les
 * commandes SAP ouvertes de clients HORS des 3 segments livrés (GMS/CHR/EXPORT)
 * comme PRÉPARÉES + PARTIES (livrées). Ces ventes quittent le magasin à la
 * caisse : elles n'ont rien à faire en « à préparer » et traînaient comme non
 * préparées, polluant l'inventaire.
 *
 * À usage ponctuel (rattrapage) — les NOUVELLES commandes comptoir sont marquées
 * d'office à la création (cf. /api/sap/orders). Idempotent : une commande déjà
 * préparée ET partie est sautée (on préserve son horodatage d'origine).
 *
 * Prudence : on ne marque QUE les commandes dont le CardCode résout vers une
 * fiche Client (directement ou via une adresse de livraison) — un CardCode non
 * résolu n'est jamais présumé comptoir (il pourrait être une adresse GMS).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const email = (session.user.email ?? "").trim().toLowerCase();
  const scope = await getAccessScope(session);
  const canManage = !!scope.all || (await isPreparateur(email));
  if (!canManage) return NextResponse.json({ error: "Réservé aux responsables" }, { status: 403 });

  type SapOrder = { DocEntry: number; CardCode: string; Cancelled?: string };
  let orders: SapOrder[];
  try {
    orders = await sap.getAll<SapOrder>(
      "Orders?$filter=" + encodeURIComponent("DocumentStatus eq 'bost_Open'") +
        "&$select=DocEntry,CardCode,Cancelled",
      { pageSize: 200, maxPages: 60 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur SAP (commandes)" },
      { status: 502 },
    );
  }
  orders = orders.filter((o) => o.Cancelled !== "tYES");

  // Type + groupe SAP par CardCode. Colonnes groupe non typées côté Prisma → raw
  // SQL (idem /api/inventaire/prep-orders). On couvre le code principal ET les
  // adresses de livraison (ClientDeliveryMode.sapCardCode → client).
  const cardCodes = [...new Set(orders.map((o) => o.CardCode).filter(Boolean))];
  const cliByCard = new Map<string, { type: string | null; groupCode: number | null; groupName: string | null }>();
  if (cardCodes.length) {
    const ph = cardCodes.map((_, i) => `$${i + 1}`).join(",");
    const rows = await prisma.$queryRawUnsafe<
      { code: string; type: string | null; sapGroupCode: number | null; sapGroupName: string | null }[]
    >(
      `SELECT "code","type","sapGroupCode","sapGroupName" FROM "Client" WHERE "code" IN (${ph})`,
      ...cardCodes,
    );
    for (const r of rows) cliByCard.set(r.code, { type: r.type, groupCode: r.sapGroupCode, groupName: r.sapGroupName });

    // Adresses de livraison encore non résolues → jointure ClientDeliveryMode.
    const unresolved = cardCodes.filter((c) => !cliByCard.has(c));
    if (unresolved.length) {
      const ph2 = unresolved.map((_, i) => `$${i + 1}`).join(",");
      try {
        const modes = await prisma.$queryRawUnsafe<
          { code: string; type: string | null; sapGroupCode: number | null; sapGroupName: string | null }[]
        >(
          `SELECT dm."sapCardCode" AS code, c."type", c."sapGroupCode", c."sapGroupName"
             FROM "ClientDeliveryMode" dm JOIN "Client" c ON c.id = dm."clientId"
            WHERE dm."sapCardCode" IN (${ph2})`,
          ...unresolved,
        );
        for (const r of modes) if (!cliByCard.has(r.code)) {
          cliByCard.set(r.code, { type: r.type, groupCode: r.sapGroupCode, groupName: r.sapGroupName });
        }
      } catch { /* table absente → on garde les codes principaux */ }
    }
  }

  // Statuts déjà posés → on saute les commandes déjà préparées ET parties.
  const st = await getDeliveryStatuses().catch(() => null);

  const candidates = orders.filter((o) => {
    const cli = cliByCard.get(o.CardCode);
    if (!cli) return false;                        // CardCode non résolu → prudence, on ne touche pas
    if (!isComptoirClient(cli)) return false;      // GMS/CHR/EXPORT → flux de préparation normal
    if (st && st.prepared.get(o.DocEntry) && st.departed.get(o.DocEntry)) return false; // déjà à jour
    return true;
  });

  const by = session.user.name?.trim() || email || "Comptoir";
  let marked = 0;
  const CHUNK = 20;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK);
    await Promise.all(
      slice.map((o) =>
        markComptoirDelivered(o.DocEntry, by).then(() => { marked++; }).catch(() => { /* ligne en échec ignorée */ }),
      ),
    );
  }

  return NextResponse.json({
    ok: true,
    scanned: orders.length,
    candidates: candidates.length,
    marked,
    env: sap.getEnvironment().env,
  });
}
