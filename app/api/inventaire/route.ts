import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import {
  listSessions, getSession, saveSession, isPreparateur, sanitizePhotos,
  type InventoryLine, type InventorySession, type InventoryPrep,
} from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Identifiants techniques sans Date.now()/Math.random() interdits ailleurs : ici en route serveur c'est OK. */
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const nowIso = () => new Date().toISOString();

/** Retire les photos (lourdes) d'une session pour les réponses de LISTE. */
function stripPhotos(s: InventorySession): InventorySession {
  return { ...s, photos: [], nbPhotos: s.photos?.length ?? 0 };
}

/** Identité de l'opérateur courant (email, repli nom). */
function actorOf(session: { user?: { email?: string | null; name?: string | null } }): string {
  return session.user?.email ?? session.user?.name ?? "?";
}

/** Normalise la trace de pré-étape « commandes non préparées » (best-effort). */
function parsePrep(raw: unknown): InventoryPrep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nums = Array.isArray(r.nonPreparedDocNums) ? r.nonPreparedDocNums.map(Number).filter(Number.isFinite) : [];
  const entries = Array.isArray(r.nonPreparedDocEntries) ? r.nonPreparedDocEntries.map(Number).filter(Number.isFinite) : [];
  if (nums.length === 0 && entries.length === 0) return null;
  return {
    nonPreparedDocNums: nums.slice(0, 500),
    nonPreparedDocEntries: entries.slice(0, 500),
    addedColis: Math.round((Number(r.addedColis) || 0) * 10) / 10,
    ordersScanned: Math.max(0, Math.floor(Number(r.ordersScanned) || 0)),
    at: nowIso(),
  };
}

/** Normalise les lignes reçues : ne garde que celles réellement comptées.
 *  L'écart est arrondi au 0,1 — MÊME granularité que le client (lib inv-utils
 *  ecartOf + sapInfo) et que l'affichage (fmt) : la pastille « écart » vue avant
 *  envoi reste identique à celle stockée (sinon un écart < 0,05 « flippait »). */
function parseLines(raw: unknown): InventoryLine[] {
  const arr = Array.isArray(raw) ? (raw as Omit<InventoryLine, "ecart">[]) : [];
  return arr
    .filter((l) => l && l.itemCode && Number.isFinite(l.realQty))
    .map((l) => ({
      itemCode: String(l.itemCode),
      itemName: String(l.itemName ?? l.itemCode),
      sapQty: Number(l.sapQty) || 0,
      realQty: Number(l.realQty) || 0,
      unit: String(l.unit ?? ""),
      ecart: Math.round(((Number(l.realQty) || 0) - (Number(l.sapQty) || 0)) * 10) / 10,
    }));
}

/**
 * GET — sessions d'inventaire.
 *   • `?id=<id>` → UNE session complète (photos incluses) pour le détail/lightbox.
 *   • sinon      → la LISTE, photos retirées (payload léger), `nbPhotos` conservé.
 * Admin OU préparateur (« personne en charge du stock ») : tout (ils peuvent
 * repasser dessus). Autre compte : uniquement ses propres comptages.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const admin = await requireAdmin(session);
  const prep = await isPreparateur(session.user.email);
  const canManage = admin || prep;       // peut voir tout + valider / rouvrir / corriger
  const email = session.user.email?.toLowerCase() ?? "";

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const s = await getSession(id);
    if (!s) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    if (!canManage && s.createdBy.toLowerCase() !== email) {
      return NextResponse.json({ error: "Réservé" }, { status: 403 });
    }
    return NextResponse.json({ session: { ...s, photos: s.photos ?? [] } });
  }

  let sessions = await listSessions();
  if (!canManage) sessions = sessions.filter((s) => s.createdBy.toLowerCase() === email);

  return NextResponse.json({
    sessions: sessions.map(stripPhotos),
    isAdmin: admin,
    isPreparateur: prep,
    canManage,
    pendingReview: canManage ? sessions.filter((s) => s.status === "submitted").length : 0,
  });
}

/** POST — soumet un comptage (+ photos d'entrepôt) → crée une session avec écarts. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { note?: string; lines?: Omit<InventoryLine, "ecart">[]; photos?: unknown; prep?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  // On ne garde que les lignes effectivement comptées (realQty renseigné).
  const lines = parseLines(body.lines);
  const photos = sanitizePhotos(body.photos, newId, nowIso);

  if (lines.length === 0 && photos.length === 0) {
    return NextResponse.json({ error: "Ajoute au moins un comptage ou une photo." }, { status: 400 });
  }

  // UN SEUL inventaire complet par jour (heure de Paris). Un 2ᵉ comptage le même
  // jour est refusé : on corrige l'inventaire existant (PUT) au lieu d'en créer
  // un nouveau, sinon les états s'empilent et faussent le suivi des écarts.
  const parisDay = (iso: string) => new Date(iso).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  const today = parisDay(nowIso());
  const existingToday = (await listSessions()).find((x) => parisDay(x.createdAt) === today);
  if (existingToday) {
    return NextResponse.json(
      { error: "Un inventaire a déjà été créé aujourd'hui. Corrige-le (bouton « Corriger ») au lieu d'en créer un nouveau.", existingId: existingToday.id },
      { status: 409 },
    );
  }

  const s: InventorySession = {
    id: newId(),
    status: "submitted",
    createdBy: actorOf(session),
    note: (body.note ?? "").trim().slice(0, 500),
    lines,
    photos,
    nbEcarts: lines.filter((l) => Math.abs(l.ecart) > 0.001).length,
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedBy: null,
    prep: parsePrep(body.prep),
  };
  await saveSession(s);
  // Réponse allégée (pas besoin de renvoyer les photos qu'on vient d'uploader).
  return NextResponse.json({ ok: true, session: stripPhotos(s) });
}

/**
 * PATCH — « repasser dessus » une session, réservé à l'admin OU au préparateur
 * (personne en charge du stock).
 *   • action "review" (défaut) → submitted → reviewed (validation).
 *   • action "reopen"          → reviewed → submitted (réouverture pour re-contrôle).
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const canManage = (await requireAdmin(session)) || (await isPreparateur(session.user.email));
  if (!canManage) {
    return NextResponse.json({ error: "Réservé aux administrateurs et préparateurs" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const action = body?.action === "reopen" ? "reopen" : "review";

  const s = await getSession(id);
  if (!s) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });

  const actor = actorOf(session);
  if (action === "reopen") {
    s.status = "submitted";
    s.reviewedAt = null;
    s.reviewedBy = null;
    s.reopenedAt = nowIso();
    s.reopenedBy = actor;
  } else {
    s.status = "reviewed";
    s.reviewedAt = nowIso();
    s.reviewedBy = actor;
  }
  await saveSession(s);
  return NextResponse.json({ ok: true, session: stripPhotos(s) });
}

/**
 * PUT — corrige / recompte une session existante EN PLACE (admin OU préparateur).
 * Remplace lignes / photos / note, recalcule les écarts, repasse la session en
 * « submitted » (à re-valider) et trace l'auteur de la correction. Permet de
 * « repasser dessus » un inventaire déjà envoyé ou déjà revu.
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const canManage = (await requireAdmin(session)) || (await isPreparateur(session.user.email));
  if (!canManage) {
    return NextResponse.json({ error: "Réservé aux administrateurs et préparateurs" }, { status: 403 });
  }

  let body: { id?: string; note?: string; lines?: Omit<InventoryLine, "ecart">[]; photos?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const s = await getSession(body.id);
  if (!s) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });

  const lines = parseLines(body.lines);
  const photos = sanitizePhotos(body.photos, newId, nowIso);
  if (lines.length === 0 && photos.length === 0) {
    return NextResponse.json({ error: "Ajoute au moins un comptage ou une photo." }, { status: 400 });
  }

  s.note = (body.note ?? "").trim().slice(0, 500);
  s.lines = lines;
  s.photos = photos;
  s.nbEcarts = lines.filter((l) => Math.abs(l.ecart) > 0.001).length;
  s.status = "submitted";       // une correction repasse en « à revoir »
  s.reviewedAt = null;
  s.reviewedBy = null;
  s.updatedAt = nowIso();
  s.updatedBy = actorOf(session);
  await saveSession(s);
  return NextResponse.json({ ok: true, session: stripPhotos(s) });
}
