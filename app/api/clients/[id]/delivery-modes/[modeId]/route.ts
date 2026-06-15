import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/** PATCH / DELETE pour une delivery mode spécifique. */

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; modeId: string } },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const body = await req.json();
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (body.name !== undefined) { updates.push(`name = $${i++}`); values.push(String(body.name).trim()); }
  if (body.sapCardCode !== undefined) { updates.push(`"sapCardCode" = $${i++}`); values.push(String(body.sapCardCode).trim()); }
  if (body.isDefault === true) {
    // If setting as default, demote others first
    await prisma.$executeRawUnsafe(
      `UPDATE "ClientDeliveryMode" SET "isDefault" = false WHERE "clientId" = $1 AND id != $2`,
      params.id, params.modeId,
    );
    updates.push(`"isDefault" = true`);
  } else if (body.isDefault === false) {
    updates.push(`"isDefault" = false`);
  }
  if (updates.length === 0) return NextResponse.json({ ok: true });
  updates.push(`"updatedAt" = NOW()`);
  values.push(params.modeId);
  await prisma.$executeRawUnsafe(
    `UPDATE "ClientDeliveryMode" SET ${updates.join(", ")} WHERE id = $${i}`,
    ...values,
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; modeId: string } },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  await prisma.$executeRawUnsafe(
    `DELETE FROM "ClientDeliveryMode" WHERE id = $1 AND "clientId" = $2`,
    params.modeId, params.id,
  );
  return NextResponse.json({ ok: true });
}
