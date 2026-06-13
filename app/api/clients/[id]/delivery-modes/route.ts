import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET    /api/clients/[id]/delivery-modes        → list
 * POST   /api/clients/[id]/delivery-modes        → create { name, sapCardCode, isDefault? }
 * Other DELETE/PATCH handled in [modeId]/route.ts
 *
 * Pour bypass un Prisma client pas encore régénéré, on fait du SQL brut sur la table.
 */

interface ModeRow {
  id: string; clientId: string; name: string; sapCardCode: string;
  isDefault: boolean; createdAt: Date; updatedAt: Date;
}

function cuid() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const modes = await prisma.$queryRawUnsafe<ModeRow[]>(
    `SELECT id, "clientId", name, "sapCardCode", "isDefault", "createdAt", "updatedAt"
     FROM "ClientDeliveryMode"
     WHERE "clientId" = $1
     ORDER BY "isDefault" DESC, name ASC`,
    params.id,
  );

  return NextResponse.json({ modes });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name || "").trim();
  const sapCardCode = String(body.sapCardCode || "").trim();
  const isDefault = !!body.isDefault;

  if (!name || !sapCardCode) {
    return NextResponse.json({ error: "name et sapCardCode requis" }, { status: 400 });
  }

  // If marked default, demote others first
  if (isDefault) {
    await prisma.$executeRawUnsafe(
      `UPDATE "ClientDeliveryMode" SET "isDefault" = false WHERE "clientId" = $1`,
      params.id,
    );
  }

  const id = cuid();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ClientDeliveryMode" ("id","clientId","name","sapCardCode","isDefault","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
    id, params.id, name, sapCardCode, isDefault,
  );

  return NextResponse.json({ id, name, sapCardCode, isDefault }, { status: 201 });
}
