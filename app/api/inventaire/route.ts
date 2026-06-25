import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import {
  listSessions, getSession, saveSession, isPreparateurEmail, sanitizePhotos,
  type InventoryLine, type InventorySession,
} from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Identifiants techniques sans Date.now()/Math.random() interdits ailleurs : ici en route serveur c'est OK. */
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const nowIso = () => new Date().toISOString();

/** Retire les photos (lourdes) d'une session pour les réponses de LISTE. */
function stripPhotos(s: InventorySession): InventorySession {
  return { ...s, photos: [], nbPhotos: s.photos?.length ?? 0 };
}

/**
 * GET — sessions d'inventaire.
 *   • `?id=<id>` → UNE session complète (photos incluses) pour le détail/lightbox.
 *   • sinon      → la LISTE, photos retirées (payload léger), `nbPhotos` conservé.
 * Admin : tout. Préparateur : uniquement les siennes.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const admin = await requireAdmin(session);
  const email = session.user.email?.toLowerCase() ?? "";

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const s = await getSession(id);
    if (!s) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    if (!admin && s.createdBy.toLowerCase() !== email) {
      return NextResponse.json({ error: "Réservé" }, { status: 403 });
    }
    return NextResponse.json({ session: { ...s, photos: s.photos ?? [] } });
  }

  let sessions = await listSessions();
  if (!admin) sessions = sessions.filter((s) => s.createdBy.toLowerCase() === email);

  return NextResponse.json({
    sessions: sessions.map(stripPhotos),
    isAdmin: admin,
    isPreparateur: isPreparateurEmail(session.user.email),
    pendingReview: admin ? sessions.filter((s) => s.status === "submitted").length : 0,
  });
}

/** POST — soumet un comptage (+ photos d'entrepôt) → crée une session avec écarts. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { note?: string; lines?: Omit<InventoryLine, "ecart">[]; photos?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const raw = Array.isArray(body.lines) ? body.lines : [];
  // On ne garde que les lignes effectivement comptées (realQty renseigné).
  const lines: InventoryLine[] = raw
    .filter((l) => l && l.itemCode && Number.isFinite(l.realQty))
    .map((l) => ({
      itemCode: String(l.itemCode),
      itemName: String(l.itemName ?? l.itemCode),
      sapQty: Number(l.sapQty) || 0,
      realQty: Number(l.realQty) || 0,
      unit: String(l.unit ?? ""),
      ecart: Math.round(((Number(l.realQty) || 0) - (Number(l.sapQty) || 0)) * 100) / 100,
    }));

  const photos = sanitizePhotos(body.photos, newId, nowIso);

  if (lines.length === 0 && photos.length === 0) {
    return NextResponse.json({ error: "Ajoute au moins un comptage ou une photo." }, { status: 400 });
  }

  const s: InventorySession = {
    id: newId(),
    status: "submitted",
    createdBy: session.user.email ?? session.user.name ?? "?",
    note: (body.note ?? "").trim().slice(0, 500),
    lines,
    photos,
    nbEcarts: lines.filter((l) => Math.abs(l.ecart) > 0.001).length,
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedBy: null,
  };
  await saveSession(s);
  // Réponse allégée (pas besoin de renvoyer les photos qu'on vient d'uploader).
  return NextResponse.json({ ok: true, session: stripPhotos(s) });
}

/** PATCH — admin marque une session « revue ». */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const s = await getSession(id);
  if (!s) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
  s.status = "reviewed";
  s.reviewedAt = nowIso();
  s.reviewedBy = session.user.email ?? session.user.name ?? "?";
  await saveSession(s);
  return NextResponse.json({ ok: true, session: stripPhotos(s) });
}
