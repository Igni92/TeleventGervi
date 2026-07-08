import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDirection, directionEmails } from "@/lib/permissions";
import { notifyEmails } from "@/lib/push";
import {
  validateConge, canDecide, congeDayCount, CONGE_TYPE_LABEL,
  type CongeRequest, type CongeType,
} from "@/lib/conges";
import { saveConge, getConge, listUserConges, listAllConges } from "@/lib/congesRh";

/**
 * CONGÉS — demande salarié → validation DIRECTION.
 *
 *   GET                          → mes demandes (+ direction : toutes + nb en attente)
 *   POST { action: "request", type, start, end, note }        (salarié)  → push direction
 *   POST { action: "decide", id, email, decision, note }      (direction)→ push salarié
 *   POST { action: "cancel", id }                             (salarié)  → annule sa demande
 *
 * Validation réservée à la DIRECTION (isDirection). Push best-effort.
 */
export const dynamic = "force-dynamic";

async function ctx() {
  const session = await auth();
  if (!session?.user) return null;
  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) return null;
  return { email, name: session.user.name?.trim() || email, isDir: await isDirection(session) };
}

const fmt = (iso: string) => {
  try { return new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "2-digit" }); }
  catch { return iso; }
};
const rangeLabel = (c: { start: string; end: string }) =>
  c.start === c.end ? fmt(c.start) : `${fmt(c.start)} → ${fmt(c.end)}`;

/** id court trié chronologiquement (préfixe temps → tri lexicographique stable). */
function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET() {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const mine = await listUserConges(c.email);
  const out: Record<string, unknown> = { ok: true, isDirection: c.isDir, mine };
  if (c.isDir) {
    const all = await listAllConges();
    out.all = all;
    out.pending = all.filter((x) => x.status === "pending").length;
  }
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { action?: string; id?: unknown; email?: unknown; type?: unknown; start?: unknown; end?: unknown; note?: unknown; decision?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const action = body.action;
  const now = new Date().toISOString();
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";

  // ── Salarié : poser une demande ──
  if (action === "request") {
    const err = validateConge({ type: body.type, start: body.start, end: body.end });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const conge: CongeRequest = {
      id: newId(), email: c.email, name: c.name,
      type: body.type as CongeType, start: body.start as string, end: body.end as string,
      note, status: "pending", createdAt: now,
    };
    await saveConge(conge);
    const days = congeDayCount(conge.start, conge.end);
    notifyEmails(await directionEmails(), {
      title: "🌴 Demande de congés",
      body: `${c.name} — ${CONGE_TYPE_LABEL[conge.type]}, ${rangeLabel(conge)}${days ? ` (${days} j)` : ""} à valider.`,
      url: "/heures", tag: `conge-${conge.id}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, conge });
  }

  // ── Direction : valider / refuser ──
  if (action === "decide") {
    if (!c.isDir) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const id = String(body.id ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const decision = body.decision === "approved" ? "approved" : body.decision === "refused" ? "refused" : null;
    if (!id || !email || !decision) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    const cur = await getConge(email, id);
    if (!canDecide(cur)) return NextResponse.json({ error: "Demande déjà traitée." }, { status: 409 });
    const next: CongeRequest = { ...cur!, status: decision, decidedAt: now, decidedBy: c.email, decisionNote: note || undefined };
    await saveConge(next);
    notifyEmails([email], {
      title: decision === "approved" ? "🌴 Congés validés" : "🌴 Congés refusés",
      body: `${CONGE_TYPE_LABEL[next.type]} ${rangeLabel(next)} — ${decision === "approved" ? "validé" : "refusé"} par la direction.`,
      url: "/heures", tag: `conge-${id}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: next.status });
  }

  // ── Salarié : annuler sa propre demande (tant qu'elle est en attente) ──
  if (action === "cancel") {
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const cur = await getConge(c.email, id);
    if (!cur) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
    if (cur.status !== "pending") return NextResponse.json({ error: "Demande déjà traitée." }, { status: 409 });
    await saveConge({ ...cur, status: "cancelled", decidedAt: now, decidedBy: c.email });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
