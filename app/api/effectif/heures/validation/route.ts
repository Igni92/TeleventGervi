import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope, ADMIN_EMAILS } from "@/lib/permissions";
import { isMonthId, monthLabel } from "@/lib/heuresCalc";
import { notifyEmails } from "@/lib/push";
import {
  monthToValidate, getValidation, saveValidation, listValidations,
  applyAction, canAct, whoMustAct, type ValidAction,
} from "@/lib/heuresValidation";

/**
 * VALIDATION MENSUELLE DES HEURES (employeur ⇄ salarié).
 *
 *   GET  ?month=YYYY-MM        → mon état + (managers) l'état de l'équipe + si un
 *                                rappel « à envoyer » est dû (push mensuel dédupliqué).
 *   POST { action, month, … }  → transitions :
 *     • send    (manager)  : envoie à tous les salariés (ou `users[]`) → push salariés
 *     • validate(salarié)  : valide ses heures                        → push employeur
 *     • counter (salarié)  : propose une autre date (recupDates,note)  → push employeur
 *     • accept  (manager)  : accepte la proposition d'un salarié       → push salarié
 *     • resend  (manager)  : renvoie au salarié                        → push salarié
 *
 * Manager = direction/admin (getAccessScope().all). Le salarié n'agit que quand
 * la balle est dans son camp (verrou `canAct`). Push best-effort (fire-and-forget).
 */
export const dynamic = "force-dynamic";

async function ctx() {
  const session = await auth();
  if (!session?.user) return null;
  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) return null;
  const scope = await getAccessScope(session);
  return { email, name: session.user.name?.trim() || email, isManager: !!scope.all };
}

/** Emails employeurs (direction/admin) — destinataires des notifs côté employeur. */
async function managerEmails(): Promise<Set<string>> {
  const set = new Set(ADMIN_EMAILS.map((e) => e.trim().toLowerCase()));
  try {
    const rows = await prisma.$queryRawUnsafe<{ email: string | null }[]>(
      `SELECT "email" FROM "User" WHERE "isAdmin" = true OR "isDirection" = true`,
    );
    for (const r of rows) if (r.email) set.add(r.email.trim().toLowerCase());
  } catch { /* colonnes absentes → ADMIN_EMAILS seuls */ }
  return set;
}

/** Salariés (comptes avec email) HORS employeurs — cible « à faire valider ». */
async function employees(mgr: Set<string>): Promise<{ email: string; name: string }[]> {
  const users = await prisma.user.findMany({ select: { email: true, name: true } });
  return users
    .filter((u) => u.email)
    .map((u) => ({ email: u.email!.trim().toLowerCase(), name: u.name || u.email! }))
    .filter((u) => !mgr.has(u.email));
}

export async function GET(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const month = new URL(req.url).searchParams.get("month") || monthToValidate(new Date());
  if (!isMonthId(month)) return NextResponse.json({ error: "Mois invalide" }, { status: 400 });

  const mine = await getValidation(c.email, month);
  const out: Record<string, unknown> = {
    ok: true, month, monthLabel: monthLabel(month), isManager: c.isManager,
    mine, mustValidate: whoMustAct(mine) === "employee",
  };

  if (c.isManager) {
    const mgr = await managerEmails();
    const [emps, vals] = await Promise.all([employees(mgr), listValidations(month)]);
    const team = emps.map((e) => {
      const v = vals.get(e.email) ?? null;
      return { email: e.email, name: e.name, status: v?.status ?? null, proposal: v?.proposal ?? [], note: v?.note ?? "", mustAct: whoMustAct(v) };
    });
    const toSend = team.filter((t) => t.status === null).length;
    const counters = team.filter((t) => t.status === "counter").length;
    out.team = team;
    out.toSend = toSend;
    out.counters = counters;
    out.reminderDue = toSend > 0;

    // Push MENSUEL à l'employeur, UNE seule fois (déduplication AppSetting) — le
    // popup in-app couvre l'appareil courant, le push touche les autres appareils.
    if (toSend > 0) {
      const nk = `rhvalidnotified:${c.email}:${month}`;
      const seen = await prisma.appSetting.findUnique({ where: { key: nk } }).catch(() => null);
      if (!seen) {
        await prisma.appSetting.create({ data: { key: nk, value: new Date().toISOString() } }).catch(() => {});
        notifyEmails([c.email], {
          title: "🕐 Heures du mois", body: `Envoyez les heures de ${monthLabel(month)} aux salariés pour validation.`,
          url: "/heures", tag: `heures-remind-${month}`, renotify: true,
        }).catch(() => {});
      }
    }
  }

  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const c = await ctx();
  if (!c) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { action?: string; month?: string; users?: unknown; user?: unknown; recupDates?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const action = body.action as ValidAction | undefined;
  const month = (typeof body.month === "string" && body.month) || monthToValidate(new Date());
  if (!isMonthId(month)) return NextResponse.json({ error: "Mois invalide" }, { status: 400 });
  const now = new Date().toISOString();
  const mName = monthLabel(month);
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : undefined;

  // ── Employeur : envoyer à tous (ou à une liste) ──
  if (action === "send") {
    if (!c.isManager) return NextResponse.json({ error: "Réservé à l'employeur" }, { status: 403 });
    const mgr = await managerEmails();
    const requested = Array.isArray(body.users) ? body.users.map((x) => String(x).trim().toLowerCase()) : null;
    const all = (await employees(mgr)).map((e) => e.email);
    const targets = [...new Set((requested ?? all).filter((e) => e && !mgr.has(e)))];
    let sent = 0;
    for (const email of targets) {
      const cur = await getValidation(email, month);
      if (!canAct(cur, "send", "manager")) continue;   // déjà envoyé / en cours → on ne réinitialise pas
      await saveValidation(applyAction(cur, { action: "send", by: c.email, role: "manager", month, email, at: now }));
      sent++;
    }
    if (sent > 0) {
      notifyEmails(targets, {
        title: "🕐 Heures à valider", body: `Vos heures de ${mName} sont prêtes — validez-les.`,
        url: "/heures", tag: `heures-valid-${month}`, renotify: true,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, sent });
  }

  // ── Salarié : valider / proposer une autre date ──
  if (action === "validate" || action === "counter") {
    const cur = await getValidation(c.email, month);
    if (!canAct(cur, action, "employee")) {
      return NextResponse.json({ error: "Action impossible dans l'état actuel." }, { status: 409 });
    }
    const next = applyAction(cur, {
      action, by: c.email, role: "employee", month, email: c.email,
      recupDates: action === "counter" ? (body.recupDates as string[] | undefined) : undefined, note, at: now,
    });
    await saveValidation(next);
    const verb = action === "validate" ? "a validé ses heures" : "propose une autre date";
    notifyEmails([...await managerEmails()], {
      title: "🕐 Heures — réponse salarié", body: `${c.name} ${verb} pour ${mName}.`,
      url: "/heures", tag: `heures-valid-${month}-${c.email}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: next.status });
  }

  // ── Employeur : accepter la proposition / renvoyer ──
  if (action === "accept" || action === "resend") {
    if (!c.isManager) return NextResponse.json({ error: "Réservé à l'employeur" }, { status: 403 });
    const email = String(body.user ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });
    const cur = await getValidation(email, month);
    if (!canAct(cur, action, "manager")) {
      return NextResponse.json({ error: "Action impossible dans l'état actuel." }, { status: 409 });
    }
    const next = applyAction(cur, { action, by: c.email, role: "manager", month, email, note, at: now });
    await saveValidation(next);
    notifyEmails([email], {
      title: "🕐 Heures",
      body: action === "accept" ? `Votre proposition pour ${mName} est acceptée — c'est validé.` : `Vos heures de ${mName} vous sont renvoyées.`,
      url: "/heures", tag: `heures-valid-${month}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: next.status });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
