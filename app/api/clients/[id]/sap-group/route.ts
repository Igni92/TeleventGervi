import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * PATCH /api/clients/[id]/sap-group   { groupCode }
 *
 * Édition BIDIRECTIONNELLE du groupe client : écrit le GroupCode sur le
 * BusinessPartner SAP (qui pilote le coefficient de prix conseillé) PUIS
 * met à jour le cache local (sapGroupCode / sapGroupName).
 *
 * ⚠️ Le groupe conditionne la marge (coef de prix) — modification volontaire
 * et tracée (best-effort SAP : si SAP échoue, on n'écrit pas le cache local
 * pour ne pas désynchroniser).
 */
const Schema = z.object({ groupCode: z.number().int().nonnegative() });

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "groupCode invalide" }, { status: 400 });
  const { groupCode } = parsed.data;

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { code: true },
  });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  // 1) Écrit le groupe sur SAP (source de vérité de la marge).
  try {
    await sap.patch(`BusinessPartners('${client.code.replace(/'/g, "''")}')`, { GroupCode: groupCode });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Échec écriture SAP : ${e instanceof Error ? e.message : ""}` },
      { status: 502 },
    );
  }

  // 2) Résout le libellé du groupe (best-effort) + met à jour le cache local.
  let groupName: string | null = null;
  try {
    const g = await sap.get<{ Name?: string }>(`BusinessPartnerGroups(${groupCode})?$select=Name`);
    groupName = g.Name ?? null;
  } catch { /* libellé optionnel */ }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE "Client"
    SET "sapGroupCode" = ${groupCode}, "sapGroupName" = ${groupName}, "updatedAt" = NOW()
    WHERE "id" = ${params.id};
  `);

  return NextResponse.json({ ok: true, sapGroupCode: groupCode, sapGroupName: groupName });
}
