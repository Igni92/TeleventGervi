import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { StockDisplayUnit } from "@/lib/gervifrais-calc";

/**
 * Unité d'affichage du STOCK par groupe article (kg / colis / pièce).
 *
 * Stocké dans AppSetting (clé `stock_group_units`) sous forme d'un objet JSON
 * { "<itemGroup>": "kg" | "colis" | "piece" }. Un groupe absent = mode « auto »
 * (comportement historique : colis si l'article porte un conditionnement, sinon
 * son unité de vente). Lecture ouverte à tout compte connecté ; écriture admin.
 *
 *   GET → { ok, units, isAdmin }
 *   PUT → body { groupId: number, unit: "kg"|"colis"|"piece"|null }  (null = auto)
 */
export const dynamic = "force-dynamic";

const SETTING_KEY = "stock_group_units";
const VALID: StockDisplayUnit[] = ["kg", "colis", "piece"];

async function readUnits(): Promise<Record<string, StockDisplayUnit>> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    const out: Record<string, StockDisplayUnit> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && (VALID as string[]).includes(v)) out[k] = v as StockDisplayUnit;
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);
  return NextResponse.json({ ok: true, units: await readUnits(), isAdmin: scope.all });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);
  if (!scope.all) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const groupId = Number(body.groupId);
  if (!Number.isFinite(groupId)) return NextResponse.json({ error: "groupId requis" }, { status: 400 });

  const rawUnit = body.unit;
  if (rawUnit !== null && !(typeof rawUnit === "string" && (VALID as string[]).includes(rawUnit))) {
    return NextResponse.json({ error: "unit invalide (kg | colis | piece | null)" }, { status: 400 });
  }

  const units = await readUnits();
  if (rawUnit === null) delete units[String(groupId)];
  else units[String(groupId)] = rawUnit as StockDisplayUnit;

  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify(units) },
    update: { value: JSON.stringify(units) },
  });

  return NextResponse.json({ ok: true, units });
}
