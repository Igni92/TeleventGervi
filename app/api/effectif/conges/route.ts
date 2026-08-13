import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDirection, directionEmails } from "@/lib/permissions";
import { notifyEmails } from "@/lib/push";
import {
  validateConge, canDecide, canRespond, congeOrigin, congeDayCount, canChangeCongeType, isCongeType, CONGE_TYPE_LABEL,
  type CongeRequest, type CongeType,
} from "@/lib/conges";
import { saveConge, getConge, listUserConges, listAllConges, saveCongeJustificatif } from "@/lib/congesRh";
import { tagDaysInWeeks, getProfile, listUserWeekEntries } from "@/lib/heuresRh";
import { weekDates, typicalDayMinutes, type DayTag } from "@/lib/heuresCalc";
import { expandOuvrables, expandSemaine, isoWeekOfDate, computeRecupCounter, splitLeaveRecupCp } from "@/lib/planning";
import { emailDirectionConge, whatsappDirectionConge, addCongeToOutlook } from "@/lib/congesNotify";

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
    absence: { tag: "absent", days: expandOuvrables(c.start, c.end) },
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

/** Journées ENTIÈRES de récup disponibles au compteur d'un salarié =
 *  floor(solde disponible / journée type). Base de l'arbitrage récup→CP. Le
 *  « disponible » exclut DÉJÀ la récup posée d'avance (réservée) et n'inclut que
 *  les semaines TERMINÉES (mois fini) — cf. computeRecupCounter. 0 si journée
 *  type nulle (jamais de récup possible). */
async function recupWholeDaysAvailable(email: string): Promise<number> {
  const profile = await getProfile(email);
  const typDay = typicalDayMinutes(profile);
  if (typDay <= 0) return 0;
  const [entries, conges] = await Promise.all([listUserWeekEntries(email), listUserConges(email)]);
  const weeks = [...entries.entries()].map(([week, e]) => ({
    week, days: e.days, option: e.option, paySuppMin: e.paySuppMin, recupDates: e.recupDates,
  }));
  const extra = conges
    .filter((x) => x.type === "recup" && x.status === "approved")
    .flatMap((x) => expandOuvrables(x.start, x.end));
  const todayISO = todayParisISO(); // Audit 2026-08-13 (#19) : compteur du jour en Europe/Paris
  const counter = computeRecupCounter(weeks, extra, profile, todayISO);
  return Math.floor(counter.availableMin / typDay);
}

/** Date du jour au format « YYYY-MM-DD » en fuseau Europe/Paris.
 *  Audit 2026-08-13 (#19) : le serveur tourne en UTC — au petit matin (avant
 *  01h/02h Paris) `new Date().toISOString()` renvoie encore la VEILLE. Or
 *  l'arbitrage récup→CP (compteur du jour) et le verrou de changement de type
 *  (canChangeCongeType, « moins d'un jour avant la prise ») raisonnent en date
 *  MURALE française. On dérive donc la journée en Europe/Paris (en-CA). */
function todayParisISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

/**
 * ARBITRAGE QUOTIDIEN RÉCUP → CP. Une plage posée en RÉCUP est couverte JOUR DE
 * CONTRAT par jour de contrat (lun→ven hors fériés), dans l'ordre, tant que le
 * compteur de récup suffit (préfixe RÉCUP) ; dès qu'il n'y a plus de journée
 * ENTIÈRE de récup pour couvrir un jour, le reste bascule automatiquement en CP
 * (suffixe). Les SAMEDIS « bouclés » par une semaine complétée à 35 h (récup
 * allant jusqu'au vendredi) sont GRATUITS — non décomptés, ni en récup ni en CP
 * (géré par splitLeaveRecupCp). Renvoie 1 ou 2 sous-congés (récup puis CP).
 *
 * Ex. (demande direction) plage posée en récup mais compteur insuffisant pour
 * les derniers jours → préfixe en récup + suffixe en CP posé d'office.
 *
 * Les types AUTRES que « récup » (CP, RTT, maladie, absence…) passent inchangés.
 */
async function arbitrateRecupCp(
  email: string,
  base: Omit<CongeRequest, "id">,
): Promise<Omit<CongeRequest, "id">[]> {
  if (base.type !== "recup") return [base];
  const whole = await recupWholeDaysAvailable(email);
  const split = splitLeaveRecupCp(base.start, base.end, whole);
  const parts: Omit<CongeRequest, "id">[] = [];
  if (split.recup) parts.push({ ...base, type: "recup", start: split.recup.start, end: split.recup.end });
  if (split.cp) parts.push({ ...base, type: "cp", start: split.cp.start, end: split.cp.end });
  // Repli défensif : jamais renvoyer une liste vide (garde le congé d'origine).
  return parts.length ? parts : [base];
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

  let body: { action?: string; id?: unknown; email?: unknown; name?: unknown; type?: unknown; start?: unknown; end?: unknown; note?: unknown; decision?: unknown; accept?: unknown; justificatif?: unknown; justificatifName?: unknown; justified?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const action = body.action;
  const now = new Date().toISOString();
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";

  // ── Salarié : poser une demande ──
  if (action === "request") {
    const err = validateConge({ type: body.type, start: body.start, end: body.end });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    // ARBITRAGE RÉCUP→CP : une demande de RÉCUP dont le compteur ne couvre pas
    // tous les jours est découpée en préfixe récup + suffixe CP (posé d'office).
    const parts = await arbitrateRecupCp(c.email, {
      email: c.email, name: c.name,
      type: body.type as CongeType, start: body.start as string, end: body.end as string,
      note, status: "pending", origin: "salarie", createdAt: now,
    });
    const saved: CongeRequest[] = parts.map((p) => ({ ...p, id: newId() }));
    for (const conge of saved) await saveConge(conge);
    // La demande part vers l'employeur sur TOUS les canaux configurés :
    // push in-app + email + WhatsApp (chacun best-effort, aucun ne bloque).
    const dirEmails = await directionEmails();
    for (const conge of saved) {
      // Décompte réel notifié à la personne en charge des congés : jours OUVRABLES
      // (lun→sam, hors dimanches ET fériés), pas les jours calendaires bruts.
      const ouvr = expandOuvrables(conge.start, conge.end).length;
      const arb = saved.length > 1 ? " (arbitrage récup→CP)" : "";
      notifyEmails(dirEmails, {
        title: "🌴 Demande de congés",
        body: `${c.name} — ${CONGE_TYPE_LABEL[conge.type]}, ${rangeLabel(conge)}${ouvr ? ` (${ouvr} j ouvrable${ouvr > 1 ? "s" : ""}, hors dim./fériés)` : ""}${arb} à valider.`,
        url: "/planning", tag: `conge-${conge.id}`, renotify: true,
      }).catch(() => {});
      emailDirectionConge(conge, dirEmails).catch((e) => console.error("[conges] email direction:", e));
      whatsappDirectionConge(conge).catch((e) => console.error("[conges] WhatsApp direction:", e));
    }
    return NextResponse.json({ ok: true, conge: saved[0], conges: saved });
  }

  // ── Direction : PROPOSER des congés / une récup à un salarié (boomerang :
  //    c'est le SALARIÉ qui accepte ou refuse). ──
  if (action === "propose") {
    if (!c.isDir) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });
    const err = validateConge({ type: body.type, start: body.start, end: body.end });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    // ARBITRAGE RÉCUP→CP : une PROPOSITION de récup dont le compteur du salarié ne
    // couvre pas tous les jours est découpée en préfixe récup + suffixe CP.
    const parts = await arbitrateRecupCp(email, {
      email, name: String(body.name ?? email),
      type: body.type as CongeType, start: body.start as string, end: body.end as string,
      note, status: "pending", origin: "direction", createdAt: now,
    });
    const saved: CongeRequest[] = parts.map((p) => ({ ...p, id: newId() }));
    for (const conge of saved) await saveConge(conge);
    for (const conge of saved) {
      const days = congeDayCount(conge.start, conge.end);
      notifyEmails([email], {
        title: conge.type === "recup" ? "🔄 Récupération proposée" : "🌴 Congés proposés",
        body: `La direction vous propose ${CONGE_TYPE_LABEL[conge.type].toLowerCase()} ${rangeLabel(conge)}${days ? ` (${days} j)` : ""} — acceptez ou refusez.`,
        url: "/planning", tag: `conge-${conge.id}`, renotify: true,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, conge: saved[0], conges: saved });
  }

  // ── Direction : DÉCLARER directement une absence (ARRÊT MALADIE surtout) —
  //    approbation IMMÉDIATE, sans boomerang : un arrêt est un FAIT acté
  //    (certificat), le salarié en est INFORMÉ, pas sollicité. Le jour est
  //    reporté dans la feuille d'heures (tag) et poussé au calendrier Outlook. ──
  if (action === "declare") {
    if (!c.isDir) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Salarié manquant" }, { status: 400 });
    const err = validateConge({ type: body.type, start: body.start, end: body.end });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    // Justificatif (arrêt maladie) : data-URL base64 (image/PDF), stocké À PART
    // du congé. Garde-fou taille ≈ 6 Mo encodés (photo de certificat).
    let justificatifName: string | undefined;
    const rawJustif = typeof body.justificatif === "string" ? body.justificatif : "";
    if (rawJustif) {
      if (!/^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,/i.test(rawJustif)) {
        return NextResponse.json({ error: "Justificatif : image ou PDF attendu." }, { status: 400 });
      }
      if (rawJustif.length > 6_000_000) {
        return NextResponse.json({ error: "Justificatif trop volumineux (max ~4 Mo)." }, { status: 413 });
      }
      justificatifName = typeof body.justificatifName === "string" && body.justificatifName.trim()
        ? body.justificatifName.trim().slice(0, 160) : "justificatif";
    }
    const conge: CongeRequest = {
      id: newId(), email, name: String(body.name ?? email),
      type: body.type as CongeType, start: body.start as string, end: body.end as string,
      note, status: "approved", origin: "direction", createdAt: now,
      decidedAt: now, decidedBy: c.email, justificatifName,
      // Absence déclarée par la direction : justifiée ou non (les autres types : indéfini).
      ...(body.type === "absence" ? { justified: body.justified === true } : {}),
    };
    await saveConge(conge);
    if (rawJustif) await saveCongeJustificatif(email, conge.id, rawJustif).catch((e) => console.error("[conges] justificatif:", e));
    await applyApprovedConge(conge, c.email);
    addCongeToOutlook(conge, await directionEmails()).catch((e) => console.error("[conges] Outlook direction:", e));
    notifyEmails([email], {
      title: conge.type === "maladie" ? "🩺 Arrêt maladie enregistré" : "📅 Absence enregistrée",
      body: `${CONGE_TYPE_LABEL[conge.type]} ${rangeLabel(conge)} — enregistré par la direction.`,
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
    // la feuille d'heures : le calendrier d'équipe s'incrémente tout seul —
    // et l'évènement est poussé dans le calendrier OUTLOOK de la direction.
    if (accept) {
      await applyApprovedConge(next, c.email);
      addCongeToOutlook(next, await directionEmails()).catch((e) => console.error("[conges] Outlook direction:", e));
    }
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
    if (decision === "approved") {
      await applyApprovedConge(next, c.email);
      // Validé → l'évènement arrive dans le calendrier Outlook de la direction.
      addCongeToOutlook(next, await directionEmails()).catch((e) => console.error("[conges] Outlook direction:", e));
    }
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

  // ── Changer le TYPE d'un congé POSÉ (récup ↔ CP…) — décidé APRÈS la pose,
  //    modifiable jusqu'au plus tard 1 jour avant la prise (verrouillé ensuite).
  //    Le salarié le sien, ou la direction. Re-tag automatique si déjà validé. ──
  if (action === "changeType") {
    const id = String(body.id ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase() || c.email;
    const newType = body.type;
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    if (!isCongeType(newType)) return NextResponse.json({ error: "Type invalide" }, { status: 400 });
    if (email !== c.email && !c.isDir) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const cur = await getConge(email, id);
    if (!cur) return NextResponse.json({ error: "Congé introuvable" }, { status: 404 });
    const todayISO = todayParisISO(); // Audit 2026-08-13 (#19) : verrou « J-1 » en Europe/Paris
    if (!canChangeCongeType(cur, todayISO)) {
      return NextResponse.json({ error: "Type verrouillé (moins d'un jour avant la prise) ou congé non modifiable." }, { status: 409 });
    }
    if (cur.type === newType) return NextResponse.json({ ok: true, type: newType });
    const next: CongeRequest = { ...cur, type: newType as CongeType };
    await saveConge(next);
    // Congé DÉJÀ validé : on efface les tags de l'ancien type sur les jours du
    // congé (lun→sam), puis on applique le nouveau type → les compteurs (récup /
    // CP) se recalculent tout seuls.
    if (cur.status === "approved") {
      await tagDaysInWeeks(email, expandOuvrables(cur.start, cur.end), undefined, c.email, isoWeekOfDate, weekDates).catch(() => {});
      await applyApprovedConge(next, c.email);
    }
    notifyEmails([email], {
      title: "🔄 Type de congé mis à jour",
      body: `${rangeLabel(next)} → ${CONGE_TYPE_LABEL[next.type]}.`,
      url: "/planning", tag: `conge-${id}`, renotify: true,
    }).catch(() => {});
    return NextResponse.json({ ok: true, type: newType });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
