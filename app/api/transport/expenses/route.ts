import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import {
  listTransportExpenses,
  getTransportExpense,
  saveTransportExpense,
  deleteTransportExpense,
} from "@/lib/transportCostStore";
import { sanitizeTransportExpense, type TransportExpense } from "@/lib/transportCost";

export const dynamic = "force-dynamic";

/**
 * Dépenses TRANSPORTEUR (justificatifs photo à l'appui).
 *
 * GET    /api/transport/expenses        → LISTE (photos retirées, `nbPhotos`)
 * GET    /api/transport/expenses?id=X   → une dépense complète (photos incluses)
 * POST   /api/transport/expenses        → notifie une dépense (transporteur)
 * DELETE /api/transport/expenses?id=X   → supprime (direction / admin)
 *
 * Le transporteur (tout utilisateur connecté) notifie ses dépenses ; la
 * suppression est réservée à la direction / aux admins. Persistance AppSetting
 * (aucune migration) — cf. lib/transportCostStore.
 */

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

/** Retire les photos (lourdes) pour les réponses de LISTE. */
function stripPhotos(e: TransportExpense): TransportExpense {
  return { ...e, photos: [], nbPhotos: e.photos?.length ?? 0 };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (id) {
    const e = await getTransportExpense(id);
    if (!e) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true, expense: e });
  }

  const expenses = await listTransportExpenses();
  const totalAmount = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return NextResponse.json({ ok: true, expenses: expenses.map(stripPhotos), totalAmount });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const actor = session.user.email ?? session.user.name ?? null;
  const expense = sanitizeTransportExpense(body, newId(), new Date().toISOString(), actor);

  if (!expense.label && expense.amount <= 0 && expense.photos.length === 0) {
    return NextResponse.json({ error: "Renseigne au moins un libellé, un montant ou une photo." }, { status: 400 });
  }

  try {
    await saveTransportExpense(expense);
    return NextResponse.json({ ok: true, expense: stripPhotos(expense) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  await deleteTransportExpense(id);
  return NextResponse.json({ ok: true });
}
