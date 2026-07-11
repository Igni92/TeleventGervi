import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDirection, directionEmails } from "@/lib/permissions";
import { notifyEmails } from "@/lib/push";
import {
  validateConge, canDecide, canRespond, congeOrigin, congeDayCount, CONGE_TYPE_LABEL,
  type CongeRequest, type CongeType,
} from "@/lib/conges";
import { saveConge, getConge, listUserConges, listAllConges } from "@/lib/congesRh";
import { tagDaysInWeeks } from "@/lib/heuresRh";
import { weekDates, type DayTag } from "@/lib/heuresCalc";
import { expandOuvrables, expandSemaine, isoWeekOfDate } from "@/lib/planning";

/**
 * CONGÉS & RÉCUP — circuit BOOMERANG (chaque camp valide ce que l'autre pose) :
 *
 *   GET                          → mes demandes (+ direction : toutes + nb en attente)
 *   POST { action: "request", type, start, end, note }        (salarié)  → push direction
 *   POST { action: "decide", id, email, decision, note }      (direction)→ push salarié
 *   POST { action: "propose", email, type, start, end, note } (direction)→ push salarié :
 *          l'employeur PROPOSE (congés / récup au vu des compteurs) — le salarié tranche
 *   POST { action: "respond", id, accept }                    (salarié)  → push direction :
 *          réponse à une proposition de la direction
 *   POST { action: "cancel", id, email? }                     → annule une demande en
 *          attente (le salarié la sienne ; la direction sa proposition)
 *
 * À l'APPROBATION (des deux circuits), les jours sont automatiquement reportés
 * dans la feuille d'heures : CP → tag « congés » (lun→ven, CRÉDITÉ d'une journée
 * type — un congé validé compte comme travaillé), récup → tag « récup »
 * (lun→sam, décompté du compteur au passage de la semaine), maladie → tag
 * « maladie ». Push best-effort.
 */
export const dynamic = "force-dynamic";

/** Reporte les jours d'un congé VALIDÉ dans les semaines saisies (tags). */
async function applyApprovedConge(c: CongeRequest, by: string): Promise<void> {
  const map: Partial<Record<CongeType, { tag: DayTag; days: string[] }>> = {
    cp: { tag: "conges", days: expandSemaine(c.start, c.end) },
    rtt: { tag: "conges", days: expandSemaine(c.start, c.end) },
    recup: { tag: "recup", days: expandOuvrables(c.start, c.end) },
    maladie: { tag: "maladie", days: expandOuvrables(c.start, c.end) },
  };
  const t = map[c.type];
  if (!t || t.days.length === 0) return;
  await tagDaysInWeeks(c.email, t.days, t.tag, by, isoWeekOfDate, weekDates).catch(() => {});
}

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

  let body: { action?: string; id?: unknown; email?: unknown; name?: unknown; type?: unknown; start?: unknown; end?: unknown; note?: unknown; decision?: unknown; accept?: unknown };
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
      note, status: "pending", origin: "salarie", createdAt: now,
    };
    await saveConge(conge);
    const days = congeDayCount(conge.start, conge.end);
    notifyEmails(await directionEmails(), {
      title: "🌴 Demande de congés",
      body: `${c.name} — ${CONGE_TYPE_LABEL[conge.type]}, ${rangeLabel(conge)}${days ? ` (${days} j)` : ""} à valider.`,
      url: "/planning", tag: `conge-${conge.id}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, conge });
  }

  // ── Direction : PROPOSER des congés / une récup à un salarié (boomerang :
  //    c'est le SALARIÉ qui accepte ou refuse). ──
  if (action === "propose") {
    if (!c.isDir) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });
    const err = validateConge({ type: body.type, start: body.start, end: body.end });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const conge: CongeRequest = {
      id: newId(), email, name: String(body.name ?? email),
      type: body.type as CongeType, start: body.start as string, end: body.end as string,
      note, status: "pending", origin: "direction", createdAt: now,
    };
    await saveConge(conge);
    const days = congeDayCount(conge.start, conge.end);
    notifyEmails([email], {
      title: conge.type === "recup" ? "🔄 Récupération proposée" : "🌴 Congés proposés",
      body: `La direction vous propose ${CONGE_TYPE_LABEL[conge.type].toLowerCase()} ${rangeLabel(conge)}${days ? ` (${days} j)` : ""} — acceptez ou refusez.`,
      url: "/planning", tag: `conge-${conge.id}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, conge });
  }

  // ── Salarié : RÉPONDRE à une proposition de la direction (boomerang) ──
  if (action === "respond") {
    const id = String(body.id ?? "").trim();
    const accept = body.decision === "approved" || body.accept === true;
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const cur = await getConge(c.email, id);
    if (!canRespond(cur, c.email)) return NextResponse.json({ error: "Proposition introuvable ou déjà traitée." }, { status: 409 });
    const next: CongeRequest = {
      ...cur!, status: accept ? "approved" : "refused",
      decidedAt: now, decidedBy: c.email, decisionNote: note || undefined,
    };
    await saveConge(next);
    // Accepté → les jours s'inscrivent dans le calendrier (perso + équipe) VIA
    // la feuille d'heures : le calendrier d'équipe s'incrémente tout seul.
    if (accept) await applyApprovedConge(next, c.email);
    notifyEmails(await directionEmails(), {
      title: accept ? "✅ Proposition acceptée" : "❌ Proposition refusée",
      body: `${c.name} a ${accept ? "accepté" : "refusé"} ${CONGE_TYPE_LABEL[next.type].toLowerCase()} ${rangeLabel(next)}.`,
      url: "/planning", tag: `conge-${id}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: next.status });
  }

  // ── Direction : valider / refuser une demande salarié ──
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
    if (decision === "approved") await applyApprovedConge(next, c.email);
    notifyEmails([email], {
      title: decision === "approved" ? "🌴 Congés validés" : "🌴 Congés refusés",
      body: `${CONGE_TYPE_LABEL[next.type]} ${rangeLabel(next)} — ${decision === "approved" ? "validé" : "refusé"} par la direction.`,
      url: "/planning", tag: `conge-${id}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: next.status });
  }

  // ── Annuler une demande EN ATTENTE : le salarié la sienne, la direction sa
  //    proposition (jamais la demande d'un salarié — elle se REFUSE). ──
  if (action === "cancel") {
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const email = String(body.email ?? "").trim().toLowerCase() || c.email;
    if (email !== c.email && !c.isDir) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const cur = await getConge(email, id);
    if (!cur) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
    if (cur.status !== "pending") return NextResponse.json({ error: "Demande déjà traitée." }, { status: 409 });
    if (email !== c.email && congeOrigin(cur) !== "direction") {
      return NextResponse.json({ error: "La demande d'un salarié se valide ou se refuse." }, { status: 403 });
    }
    await saveConge({ ...cur, status: "cancelled", decidedAt: now, decidedBy: c.email });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
