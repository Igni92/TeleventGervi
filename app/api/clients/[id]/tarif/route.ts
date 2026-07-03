import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * TARIF CLIENT — cotations SPÉCIFIQUES par code article (Écran 2, onglet
 * « Tarif »). Un prix négocié par article pour CE client : affiché dans
 * l'onglet, prioritaire sur le prix conseillé à l'ajout au panier.
 *
 *   GET  /api/clients/[id]/tarif  → { ok, items: [{ itemCode, price, note? }] }
 *   PUT  /api/clients/[id]/tarif  → { items } (remplacement complet)
 *
 * Persistance : AppSetting `tarifclient:<clientId>` (JSON), même mécanique que
 * les autres réglages métier (liv*, emaffect, bonprep).
 */

export interface TarifItem { itemCode: string; price: number; note?: string | null }

const keyOf = (clientId: string) => `tarifclient:${clientId}`;

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id))) {
    return NextResponse.json({ error: "Client hors de votre périmètre" }, { status: 403 });
  }
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(params.id) } });
    const items: TarifItem[] = row ? JSON.parse(row.value) : [];
    return NextResponse.json({ ok: true, items: Array.isArray(items) ? items : [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id))) {
    return NextResponse.json({ error: "Client hors de votre périmètre" }, { status: 403 });
  }
  let body: { items?: TarifItem[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!Array.isArray(body.items)) return NextResponse.json({ error: "items requis" }, { status: 400 });

  // Nettoyage : code non vide, prix fini ≥ 0, dédoublonné (dernier gagne), plafonné.
  const byCode = new Map<string, TarifItem>();
  for (const it of body.items) {
    const code = (it?.itemCode ?? "").trim();
    const price = Number(it?.price);
    if (!code || !Number.isFinite(price) || price < 0) continue;
    byCode.set(code, {
      itemCode: code,
      price: Math.round(price * 10000) / 10000,
      note: typeof it.note === "string" && it.note.trim() ? it.note.trim().slice(0, 120) : null,
    });
  }
  const items = [...byCode.values()].slice(0, 200);

  try {
    const key = keyOf(params.id);
    if (items.length === 0) {
      await prisma.appSetting.deleteMany({ where: { key } });
    } else {
      const value = JSON.stringify(items);
      await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
