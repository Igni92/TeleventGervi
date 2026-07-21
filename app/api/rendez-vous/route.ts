import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, getOwnSlpName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DEFAULT_NOTIFY_MINUTES_BEFORE } from "@/lib/prospection";

/**
 * AGENDA de prospection — rendez-vous (R1 physique, appels programmés).
 * GET  ?from=ISO&to=ISO  → RDV de la période, scopés (un non-admin ne voit que
 *   les siens : ownerSlp = son trigramme).
 * POST { clientId, title, type?, startAt, endAt?, location?, notes?, notifyMinutesBefore? }
 *   → crée le RDV (notif push `notifyMinutesBefore` avant, défaut 60 = 1 h) +
 *     journalise une activité. Accès : client dans le périmètre.
 * Tables prospection en SQL brut (hors client Prisma typé).
 */
export const dynamic = "force-dynamic";

type RdvRow = {
  id: string; clientId: string; ownerSlp: string | null; title: string; type: string;
  startAt: Date; endAt: Date | null; location: string | null; notes: string | null;
  notifyMinutesBefore: number; status: string; clientNom: string | null; clientCode: string | null;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const conds: string[] = [`r."status" <> 'ANNULE'`];
  const p: unknown[] = [];
  if (from) conds.push(`r."startAt" >= $${p.push(new Date(from))}`);
  if (to) conds.push(`r."startAt" <= $${p.push(new Date(to))}`);
  if (!scope.all) {
    if (!scope.slpName) return NextResponse.json({ rows: [] });
    conds.push(`r."ownerSlp" = $${p.push(scope.slpName)}`);
  }

  try {
    const rows = await prisma.$queryRawUnsafe<RdvRow[]>(
      `SELECT r."id", r."clientId", r."ownerSlp", r."title", r."type", r."startAt", r."endAt",
              r."location", r."notes", r."notifyMinutesBefore", r."status",
              c."nom" AS "clientNom", c."code" AS "clientCode"
         FROM "RendezVous" r JOIN "Client" c ON c."id" = r."clientId"
        WHERE ${conds.join(" AND ")}
        ORDER BY r."startAt" ASC`,
      ...p,
    );
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[GET /api/rendez-vous]", e);
    return NextResponse.json({ error: "Erreur serveur (migration prospection appliquée ?)" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const startRaw = typeof body.startAt === "string" ? body.startAt : "";
  const startAt = new Date(startRaw);
  if (!clientId || !title || Number.isNaN(startAt.getTime())) {
    return NextResponse.json({ error: "clientId, title et startAt (date valide) requis." }, { status: 400 });
  }
  if (!(await clientInScope(await getAccessScope(session), clientId))) {
    return NextResponse.json({ error: "Accès refusé à ce prospect." }, { status: 403 });
  }

  const type = ["R1_PHYSIQUE", "APPEL", "AUTRE"].includes(String(body.type)) ? String(body.type) : "R1_PHYSIQUE";
  const endAt = typeof body.endAt === "string" && !Number.isNaN(new Date(body.endAt).getTime()) ? new Date(body.endAt) : null;
  const location = typeof body.location === "string" ? body.location.trim().slice(0, 300) : null;
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null;
  const notifyRaw = Number(body.notifyMinutesBefore);
  const notifyMinutesBefore = Number.isFinite(notifyRaw) ? Math.min(10080, Math.max(0, Math.round(notifyRaw))) : DEFAULT_NOTIFY_MINUTES_BEFORE;

  const email = session.user.email ?? null;
  const slp = await getOwnSlpName(session);
  const id = randomUUID();

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RendezVous"
        ("id","clientId","ownerSlp","title","type","startAt","endAt","location","notes","notifyMinutesBefore","createdBy","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())`,
      id, clientId, slp, title, type, startAt, endAt, location, notes, notifyMinutesBefore, email,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ProspectionActivity" ("id","clientId","ownerSlp","kind","note","createdBy")
       VALUES ($1,$2,$3,'RDV',$4,$5)`,
      randomUUID(), clientId, slp, `RDV ${type} le ${startAt.toISOString().slice(0, 16).replace("T", " ")} — ${title}`, email,
    );
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error("[POST /api/rendez-vous]", e);
    return NextResponse.json({ error: "Erreur serveur (migration prospection appliquée ?)" }, { status: 500 });
  }
}
