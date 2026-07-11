"use client";

/**
 * PLANNING CONGÉS & RÉCUP — onglet « Planning ».
 *
 * CHAQUE SALARIÉ : son calendrier mensuel, ses COMPTEURS au-dessus (CP restants
 * + heures de récup disponibles), demande de congés (clic sur les jours) et
 * réponse aux propositions de la direction (boomerang).
 *
 * DIRECTION : un calendrier PAR PERSONNE (sélecteur) + le calendrier d'ÉQUIPE
 * (une ligne par salarié) ; propose congés/récup au vu des compteurs, valide
 * les demandes, règle le solde CP annuel et le PLAFOND de récup (les heures
 * au-delà partent au paiement sur le bulletin du mois suivant — reporté sur
 * l'état compta).
 *
 * Le circuit fait BOOMERANG : salarié demande → direction valide ; direction
 * propose → salarié accepte. Une fois validé, le jour s'inscrit dans la
 * feuille d'heures (tag) : un CP y est crédité d'une JOURNÉE TYPE (compté
 * comme travaillé), la récup se décompte du compteur AU PASSAGE DE LA SEMAINE
 * uniquement si le contrat n'y est pas atteint.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays, ChevronLeft, ChevronRight, RotateCcw, Loader2, Send, Check, X,
  Users, Palmtree, Clock3, SlidersHorizontal, Save, Sun,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { displayPersonName } from "@/lib/userNames";
import {
  fmtHM, monthIdOf, shiftMonth, monthLabel, type DayTag, DAY_TAG_LABEL,
} from "@/lib/heuresCalc";
import { monthGridDays, expandOuvrables } from "@/lib/planning";
import {
  CONGE_TYPE_LABEL, congeDayCount, congeOrigin,
  type CongeType, type CongeStatus,
} from "@/lib/conges";

/* ─────────────────────────────── Types API ─────────────────────────────────── */

interface Conge {
  id: string; email: string; name: string; type: CongeType;
  start: string; end: string; note: string; status: CongeStatus;
  origin?: "salarie" | "direction"; createdAt: string;
}
interface PersonPlanning {
  email: string;
  name: string;
  profile: { weeklyHours: number; cpAllowanceDays: number | null; recupCapHours: number | null; typicalDayMin: number };
  counters: {
    recup: { creditMin: number; debitMin: number; balanceMin: number; plannedDates: string[] };
    cp: { allowanceDays: number | null; takenDays: number; pendingDays: number; balanceDays: number | null; period: { start: string; end: string } };
    capMin: number | null;
    excessMin: number;
  };
  conges: Conge[];
  recupDates: string[];
  tags: Record<string, DayTag>;
}
interface Data {
  ok: boolean; month: string; todayISO: string;
  isManager: boolean; isDirection: boolean;
  me: PersonPlanning; team?: PersonPlanning[];
}

/* ─────────────────────────── Couleurs par type ─────────────────────────────── */

const TYPE_TONE: Record<CongeType, { solid: string; soft: string; text: string }> = {
  cp:         { solid: "bg-violet-500", soft: "bg-violet-500/15", text: "text-violet-700 dark:text-violet-300" },
  rtt:        { solid: "bg-fuchsia-500", soft: "bg-fuchsia-500/15", text: "text-fuchsia-700 dark:text-fuchsia-300" },
  recup:      { solid: "bg-sky-500", soft: "bg-sky-500/15", text: "text-sky-700 dark:text-sky-300" },
  maladie:    { solid: "bg-amber-500", soft: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-300" },
  sans_solde: { solid: "bg-zinc-400", soft: "bg-zinc-400/15", text: "text-zinc-600 dark:text-zinc-300" },
  autre:      { solid: "bg-zinc-400", soft: "bg-zinc-400/15", text: "text-zinc-600 dark:text-zinc-300" },
};
const TAG_DOT: Record<DayTag, string> = {
  present: "bg-emerald-500", absent: "bg-rose-500", conges: "bg-violet-500",
  recup: "bg-sky-500", maladie: "bg-amber-500",
};

const TYPES: CongeType[] = ["cp", "rtt", "recup", "sans_solde", "maladie", "autre"];
const fmtD = (iso: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }) : "—");
const rangeLabel = (c: { start: string; end: string }) => (c.start === c.end ? fmtD(c.start) : `${fmtD(c.start)} → ${fmtD(c.end)}`);
const fullName = (raw: string) => (raw.includes("@") ? displayPersonName(raw) : raw);

/* ────────────────────────────── Composant racine ───────────────────────────── */

export function PlanningPanel({ isManager, isDirection }: { isManager: boolean; isDirection: boolean }) {
  const [month, setMonth] = useState(() => monthIdOf(new Date()));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Managers : calendrier de QUI ? ("" = le mien)
  const [who, setWho] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/effectif/planning?month=${month}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as Data | null;
      if (j?.ok) setData(j);
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await fetch("/api/effectif/conges", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Action impossible"); return false; }
      return true;
    } catch { toast.error("Action impossible — réseau ?"); return false; }
    finally { setBusy(false); }
  };

  const respond = async (c: Conge, accept: boolean) => {
    if (await post({ action: "respond", id: c.id, accept })) {
      toast.success(accept ? "Proposition acceptée — elle s'inscrit dans votre calendrier." : "Proposition refusée.");
      await load();
    }
  };
  const decide = async (c: Conge, decision: "approved" | "refused") => {
    if (await post({ action: "decide", id: c.id, email: c.email, decision })) {
      toast.success(decision === "approved" ? "Demande validée." : "Demande refusée.");
      await load();
    }
  };
  const cancel = async (c: Conge) => {
    if (await post({ action: "cancel", id: c.id, email: c.email })) { toast.success("Annulé."); await load(); }
  };

  if (!data) {
    return (
      <SurfaceCard accent="sky" title="Planning" icon={<CalendarDays className="h-3.5 w-3.5" />}>
        <p className="py-3 text-[13px] text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement du planning…
        </p>
      </SurfaceCard>
    );
  }

  const team = data.team ?? [];
  const person: PersonPlanning = isManager && who
    ? (team.find((p) => p.email === who) ?? data.me)
    : data.me;
  const isSelf = person.email === data.me.email;

  // ── Boomerang « à traiter » ──
  // Salarié : propositions de la direction qui M'attendent.
  const proposalsForMe = data.me.conges.filter((c) => c.status === "pending" && congeOrigin(c) === "direction");
  // Direction : demandes salarié à valider + mes propositions en attente de réponse.
  const teamPending = isManager
    ? team.flatMap((p) => p.conges).filter((c) => c.status === "pending")
    : [];
  const toValidate = teamPending.filter((c) => congeOrigin(c) === "salarie");
  const awaitingAnswer = teamPending.filter((c) => congeOrigin(c) === "direction" && c.email !== data.me.email);

  const monthNav = (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mois précédent"
        className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground px-1 whitespace-nowrap capitalize">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {monthLabel(month)}
      </span>
      <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Mois suivant"
        className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
        <ChevronRight className="h-4 w-4" />
      </button>
      {month !== monthIdOf(new Date()) && (
        <button type="button" onClick={() => setMonth(monthIdOf(new Date()))} title="Revenir au mois en cours"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ── BOOMERANG : ce qui attend une réponse ── */}
      {(proposalsForMe.length > 0 || toValidate.length > 0 || awaitingAnswer.length > 0) && (
        <SurfaceCard accent="violet" title="À traiter" icon={<Send className="h-3.5 w-3.5" />}>
          <ul className="space-y-2">
            {proposalsForMe.map((c) => (
              <li key={c.id} className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[12.5px] font-semibold text-foreground">La direction vous propose</span>
                  <TypePill type={c.type} />
                  <span className="text-[12.5px] tnum text-foreground">{rangeLabel(c)}</span>
                  {congeDayCount(c.start, c.end) && <span className="text-[11.5px] text-muted-foreground tnum">{congeDayCount(c.start, c.end)} j</span>}
                </div>
                {c.note && <p className="mt-1 text-[12px] text-muted-foreground">« {c.note} »</p>}
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => respond(c, true)} disabled={busy}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold disabled:opacity-50">
                    <Check className="h-3.5 w-3.5" /> J&apos;accepte
                  </button>
                  <button type="button" onClick={() => respond(c, false)} disabled={busy}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
                    <X className="h-3.5 w-3.5" /> Je refuse
                  </button>
                </div>
              </li>
            ))}
            {isDirection && toValidate.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13px] font-semibold text-foreground">{fullName(c.name)}</span>
                  <span className="text-[11.5px] text-muted-foreground">demande</span>
                  <TypePill type={c.type} />
                  <span className="text-[12.5px] tnum text-foreground">{rangeLabel(c)}</span>
                  {congeDayCount(c.start, c.end) && <span className="text-[11.5px] text-muted-foreground tnum">{congeDayCount(c.start, c.end)} j</span>}
                </div>
                {c.note && <p className="mt-1 text-[12px] text-muted-foreground">« {c.note} »</p>}
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => decide(c, "approved")} disabled={busy}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold disabled:opacity-50">
                    <Check className="h-3.5 w-3.5" /> Valider
                  </button>
                  <button type="button" onClick={() => decide(c, "refused")} disabled={busy}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
                    <X className="h-3.5 w-3.5" /> Refuser
                  </button>
                </div>
              </li>
            ))}
            {isDirection && awaitingAnswer.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="text-[12.5px] text-muted-foreground">Proposé à</span>
                <span className="text-[12.5px] font-semibold text-foreground">{fullName(c.name)}</span>
                <TypePill type={c.type} />
                <span className="text-[12.5px] tnum text-foreground">{rangeLabel(c)}</span>
                <span className="text-[11px] italic text-muted-foreground">en attente de sa réponse</span>
                <button type="button" onClick={() => cancel(c)} disabled={busy} title="Annuler la proposition"
                  className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </SurfaceCard>
      )}

      {/* ── CALENDRIER (le mien / celui d'un salarié pour les managers) ── */}
      <SurfaceCard accent="sky"
        title={isSelf ? "Mon calendrier" : `Calendrier — ${fullName(person.name)}`}
        icon={<CalendarDays className="h-3.5 w-3.5" />} action={monthNav}>
        {isManager && team.length > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <label htmlFor="plan-who" className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground shrink-0">Calendrier de</label>
            <select id="plan-who" value={who} onChange={(e) => setWho(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="">Moi</option>
              {team.filter((p) => p.email !== data.me.email).map((p) => (
                <option key={p.email} value={p.email}>{fullName(p.name)}</option>
              ))}
            </select>
          </div>
        )}

        {/* COMPTEURS au-dessus du calendrier : CP + récup (l'exigence clé). */}
        <CounterBar person={person} isManager={isManager} />

        <PersonCalendar
          person={person} month={month} todayISO={data.todayISO}
          isSelf={isSelf} isDirection={isDirection} busy={busy}
          onSubmit={async (payload) => {
            const ok = await post(payload);
            if (ok) {
              toast.success(payload.action === "propose"
                ? "Proposition envoyée au salarié — il accepte ou refuse."
                : "Demande envoyée à la direction.");
              await load();
            }
            return ok;
          }}
        />

        {/* Réglages EMPLOYEUR : solde CP annuel + plafond de récup. */}
        {isDirection && !isSelf && (
          <EmployerSettings person={person} onSaved={load} />
        )}
        {loading && (
          <p className="mt-2 text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Actualisation…
          </p>
        )}
      </SurfaceCard>

      {/* ── CALENDRIER D'ÉQUIPE (managers) ── */}
      {isManager && team.length > 0 && (
        <SurfaceCard accent="violet" title="Calendrier d'équipe" icon={<Users className="h-3.5 w-3.5" />} action={monthNav}>
          <TeamCalendar team={team} month={month} todayISO={data.todayISO} onPick={(email) => setWho(email === data.me.email ? "" : email)} />
          <Legend />
        </SurfaceCard>
      )}
      {!isManager && <Legend />}
    </div>
  );
}

/* ─────────────────── Compteurs (au-dessus de chaque calendrier) ────────────── */

function CounterBar({ person, isManager }: { person: PersonPlanning; isManager: boolean }) {
  const { cp, recup, capMin, excessMin } = person.counters;
  return (
    <div className="mb-3 flex flex-wrap items-stretch gap-2">
      <CounterChip icon={<Palmtree className="h-3.5 w-3.5" />} tone="violet"
        label="Congés payés"
        value={cp.balanceDays == null ? `${cp.takenDays} j pris` : `${cp.balanceDays} j restants`}
        hint={cp.balanceDays == null
          ? "Solde annuel non défini par l'employeur"
          : `${cp.takenDays} j pris${cp.pendingDays ? ` · ${cp.pendingDays} j en attente` : ""} — période ${fmtD(cp.period.start)} → ${fmtD(cp.period.end)}`} />
      <CounterChip icon={<Clock3 className="h-3.5 w-3.5" />} tone="sky"
        label="Récup disponible"
        value={fmtHM(recup.balanceMin)}
        hint={`${fmtHM(recup.creditMin)} acquises · ${fmtHM(recup.debitMin)} prises${recup.plannedDates.length ? ` · ${recup.plannedDates.length} j posé(s) à venir` : ""}`} />
      {capMin != null && (
        <CounterChip icon={<SlidersHorizontal className="h-3.5 w-3.5" />} tone={excessMin > 0 ? "rose" : "muted"}
          label="Plafond récup"
          value={fmtHM(capMin)}
          hint={excessMin > 0
            ? `Dépassé de ${fmtHM(excessMin)} → payé sur le bulletin du mois suivant`
            : "Au-delà du plafond, les heures supp partent au paiement (M+1)"} />
      )}
      {excessMin > 0 && isManager && (
        <CounterChip icon={<Sun className="h-3.5 w-3.5" />} tone="rose"
          label="À payer M+1" value={fmtHM(excessMin)}
          hint="Reporté sur l'état mensuel envoyé à la compta" />
      )}
    </div>
  );
}

function CounterChip({ icon, label, value, hint, tone }: {
  icon: React.ReactNode; label: string; value: string; hint?: string;
  tone: "violet" | "sky" | "rose" | "muted";
}) {
  const tones: Record<string, string> = {
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    muted: "border-border bg-secondary/30 text-muted-foreground",
  };
  return (
    <div className={`flex-1 min-w-[150px] rounded-lg border px-3 py-2 ${tones[tone]}`} title={hint}>
      <p className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold opacity-80">{icon}{label}</p>
      <p className="text-[17px] font-bold tnum leading-tight text-foreground">{value}</p>
      {hint && <p className="text-[10.5px] leading-snug opacity-80 mt-0.5">{hint}</p>}
    </div>
  );
}

/* ─────────────────────── Calendrier mensuel d'une personne ─────────────────── */

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function PersonCalendar({ person, month, todayISO, isSelf, isDirection, busy, onSubmit }: {
  person: PersonPlanning; month: string; todayISO: string;
  isSelf: boolean; isDirection: boolean; busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const grid = useMemo(() => monthGridDays(month), [month]);
  const [selStart, setSelStart] = useState("");
  const [selEnd, setSelEnd] = useState("");
  const [type, setType] = useState<CongeType>(isDirection && !isSelf ? "recup" : "cp");
  const [note, setNote] = useState("");

  // Le mois change → la sélection ne pointe plus sur ce qu'on voit : reset.
  useEffect(() => { setSelStart(""); setSelEnd(""); }, [month, person.email]);

  // Congés par date (validé prioritaire sur en-attente pour la couleur).
  const byDate = useMemo(() => {
    const map = new Map<string, Conge[]>();
    for (const c of person.conges) {
      if (c.status !== "approved" && c.status !== "pending") continue;
      for (const d of daysBetween(c.start, c.end)) {
        const list = map.get(d);
        if (list) list.push(c); else map.set(d, [c]);
      }
    }
    return map;
  }, [person.conges]);
  const recupSet = useMemo(() => new Set(person.recupDates), [person.recupDates]);

  const clickDay = (date: string) => {
    if (!selStart || (selStart && selEnd !== selStart) || date < selStart) {
      setSelStart(date); setSelEnd(date);
    } else {
      setSelEnd(date);
    }
  };
  const inSel = (d: string) => selStart && d >= selStart && d <= selEnd;

  const ouvrables = selStart ? expandOuvrables(selStart, selEnd).length : 0;
  const canAct = isSelf || isDirection;   // un admin non-direction consulte

  const submit = async () => {
    if (!selStart) return;
    const base = { type, start: selStart, end: selEnd, note };
    const ok = isSelf
      ? await onSubmit({ action: "request", ...base })
      : await onSubmit({ action: "propose", email: person.email, name: person.name, ...base });
    if (ok) { setSelStart(""); setSelEnd(""); setNote(""); }
  };

  return (
    <div>
      {/* Grille mensuelle */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-7 bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
          {JOURS_COURTS.map((j) => <div key={j} className="px-1 py-1.5 text-center font-semibold">{j}</div>)}
        </div>
        <div className="grid grid-cols-7 divide-x divide-y divide-border/60 border-t border-border/60">
          {grid.map(({ date, inMonth }) => {
            const dayNum = Number(date.slice(-2));
            const conges = byDate.get(date) ?? [];
            const approved = conges.filter((c) => c.status === "approved");
            const pending = conges.filter((c) => c.status === "pending");
            const tag = person.tags[date];
            const isToday = date === todayISO;
            const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
            return (
              <button
                key={date} type="button"
                onClick={() => canAct && clickDay(date)}
                title={[
                  ...approved.map((c) => `${CONGE_TYPE_LABEL[c.type]} (validé)`),
                  ...pending.map((c) => `${CONGE_TYPE_LABEL[c.type]} (en attente)`),
                  ...(recupSet.has(date) ? ["Récup posée"] : []),
                  ...(tag ? [`Feuille d'heures : ${DAY_TAG_LABEL[tag]}`] : []),
                ].join(" · ") || undefined}
                className={`relative min-h-[52px] sm:min-h-[64px] p-1 text-left align-top transition-colors focus:outline-none focus:ring-1 focus:ring-brand-500
                  ${inMonth ? "bg-background" : "bg-secondary/20 opacity-50"}
                  ${dow === 0 || dow === 6 ? "bg-secondary/10" : ""}
                  ${inSel(date) ? "ring-2 ring-inset ring-brand-500 bg-brand-500/10" : canAct ? "hover:bg-secondary/40" : "cursor-default"}`}
              >
                <span className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] tnum font-semibold
                  ${isToday ? "bg-brand-500 text-white" : "text-foreground"}`}>
                  {dayNum}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-0.5">
                  {approved.map((c) => (
                    <span key={c.id} className={`h-2 w-full max-w-[46px] rounded-sm ${TYPE_TONE[c.type].solid}`} />
                  ))}
                  {pending.map((c) => (
                    <span key={c.id} className={`h-2 w-full max-w-[46px] rounded-sm border border-dashed ${TYPE_TONE[c.type].soft} border-current ${TYPE_TONE[c.type].text}`} />
                  ))}
                  {recupSet.has(date) && !approved.some((c) => c.type === "recup") && (
                    <span className="h-2 w-2 rounded-full bg-sky-500" />
                  )}
                  {tag && <span className={`h-2 w-2 rounded-full ${TAG_DOT[tag]}`} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Demande / proposition sur la sélection */}
      {canAct && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            {isSelf ? "Demander (validé par la direction)" : "Proposer à ce salarié (il accepte ou refuse)"}
            <span className="normal-case font-normal text-muted-foreground/80"> — cliquez un jour, puis le dernier jour de la plage</span>
          </p>
          <div className="flex flex-wrap items-end gap-2.5">
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as CongeType)}
                className="h-9 rounded-md border border-border bg-background px-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500">
                {TYPES.map((t) => <option key={t} value={t}>{CONGE_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Du</label>
              <input type="date" value={selStart} onChange={(e) => { setSelStart(e.target.value); if (!selEnd || selEnd < e.target.value) setSelEnd(e.target.value); }}
                className="h-9 rounded-md border border-border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Au</label>
              <input type="date" value={selEnd} min={selStart || undefined} onChange={(e) => setSelEnd(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Précision (facultatif)"
              className="h-9 flex-1 min-w-[140px] rounded-md border border-border bg-background px-2.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500" />
            <button type="button" onClick={submit} disabled={busy || !selStart}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isSelf ? "Demander" : "Proposer"}
            </button>
          </div>
          {selStart && (
            <p className="mt-2 text-[11.5px] text-muted-foreground tnum">
              {rangeLabel({ start: selStart, end: selEnd })} · {ouvrables} jour{ouvrables > 1 ? "s" : ""} ouvrable{ouvrables > 1 ? "s" : ""}
              {type === "cp" && " — les jours de CP validés comptent comme travaillés (journée type créditée)"}
              {type === "recup" && " — décomptée du compteur seulement si la semaine finit sous le contrat"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Dates ISO entre start et end incluses (léger, côté client). */
function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  if (!start || !end || end < start) return out;
  const d = new Date(`${start}T12:00:00Z`);
  while (out.length < 400) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ───────────────────────── Réglages employeur (direction) ──────────────────── */

function EmployerSettings({ person, onSaved }: { person: PersonPlanning; onSaved: () => Promise<void> }) {
  const [cp, setCp] = useState<string>(person.profile.cpAllowanceDays?.toString() ?? "");
  const [cap, setCap] = useState<string>(person.profile.recupCapHours?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCp(person.profile.cpAllowanceDays?.toString() ?? "");
    setCap(person.profile.recupCapHours?.toString() ?? "");
  }, [person.email, person.profile.cpAllowanceDays, person.profile.recupCapHours]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/effectif/planning", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: person.email, cpAllowanceDays: cp === "" ? null : Number(cp), recupCapHours: cap === "" ? null : Number(cap) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'enregistrement des réglages"); return; }
      toast.success("Réglages enregistrés.");
      await onSaved();
    } catch { toast.error("Échec de l'enregistrement des réglages"); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Réglages employeur — {fullName(person.name)}
      </p>
      <div className="flex flex-wrap items-end gap-2.5">
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Solde CP annuel (jours)</label>
          <input type="number" min={0} max={365} step={0.5} value={cp} onChange={(e) => setCp(e.target.value)} placeholder="ex. 30"
            className="h-9 w-[110px] rounded-md border border-border bg-background px-2 text-[13.5px] tnum font-semibold focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Plafond récup (heures)</label>
          <input type="number" min={0} max={1000} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="ex. 14"
            className="h-9 w-[110px] rounded-md border border-border bg-background px-2 text-[13.5px] tnum font-semibold focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <button type="button" onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Au-delà du plafond, les heures de récup partent au <b className="font-semibold">paiement des heures supp
        sur le bulletin du mois suivant</b> — reporté automatiquement sur l&apos;état mensuel envoyé à la compta.
      </p>
    </div>
  );
}

/* ─────────────────────────── Calendrier d'équipe ───────────────────────────── */

function TeamCalendar({ team, month, todayISO, onPick }: {
  team: PersonPlanning[]; month: string; todayISO: string; onPick: (email: string) => void;
}) {
  const days = useMemo(() => monthGridDays(month).filter((g) => g.inMonth), [month]);
  const rows = useMemo(() => [...team].sort((a, b) => fullName(a.name).localeCompare(fullName(b.name), "fr")), [team]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="border-collapse text-[12px] w-full">
        <thead>
          <tr className="bg-secondary/40 text-[9.5px] uppercase tracking-wide text-muted-foreground">
            <th className="sticky left-0 z-10 bg-secondary/40 text-left font-semibold px-3 py-2 min-w-[150px]">Employé · compteurs</th>
            {days.map(({ date }) => {
              const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
              return (
                <th key={date} className={`px-0.5 py-1 text-center font-semibold min-w-[24px] ${date === todayISO ? "text-brand-600 dark:text-brand-400" : ""} ${dow === 0 || dow === 6 ? "bg-secondary/50" : ""}`}>
                  <span className="block tnum">{Number(date.slice(-2))}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((p) => {
            const byDate = new Map<string, Conge>();
            for (const c of p.conges) {
              if (c.status !== "approved" && c.status !== "pending") continue;
              for (const d of daysBetween(c.start, c.end)) {
                // Le validé prime sur l'en-attente pour la couleur de la cellule.
                const cur = byDate.get(d);
                if (!cur || (cur.status === "pending" && c.status === "approved")) byDate.set(d, c);
              }
            }
            const recupSet = new Set(p.recupDates);
            return (
              <tr key={p.email}>
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5 whitespace-nowrap border-r border-border/60">
                  <button type="button" onClick={() => onPick(p.email)} title="Ouvrir son calendrier"
                    className="text-[12.5px] font-semibold text-foreground hover:text-brand-600 dark:hover:text-brand-400 text-left">
                    {fullName(p.name)}
                  </button>
                  {/* Les compteurs de la personne, VISIBLES au-dessus de sa ligne. */}
                  <span className="block text-[10.5px] tnum text-muted-foreground">
                    <span className="text-sky-600 dark:text-sky-400 font-semibold">{fmtHM(p.counters.recup.balanceMin)}</span> récup
                    {" · "}
                    <span className="text-violet-600 dark:text-violet-400 font-semibold">
                      {p.counters.cp.balanceDays == null ? `${p.counters.cp.takenDays} j pris` : `${p.counters.cp.balanceDays} j`}
                    </span> CP
                    {p.counters.excessMin > 0 && (
                      <span className="text-rose-600 dark:text-rose-400 font-semibold"> · {fmtHM(p.counters.excessMin)} payé M+1</span>
                    )}
                  </span>
                </td>
                {days.map(({ date }) => {
                  const c = byDate.get(date);
                  const tag = p.tags[date];
                  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
                  const title = c
                    ? `${fullName(p.name)} — ${CONGE_TYPE_LABEL[c.type]} (${c.status === "approved" ? "validé" : "en attente"})`
                    : recupSet.has(date) ? `${fullName(p.name)} — récup posée`
                    : tag ? `${fullName(p.name)} — ${DAY_TAG_LABEL[tag]}` : undefined;
                  return (
                    <td key={date} title={title}
                      className={`h-9 px-0.5 text-center align-middle ${dow === 0 || dow === 6 ? "bg-secondary/30" : ""} ${date === todayISO ? "outline outline-1 -outline-offset-1 outline-brand-500/40" : ""}`}>
                      {c ? (
                        <span className={`mx-auto block h-5 w-full min-w-[18px] rounded ${c.status === "approved" ? TYPE_TONE[c.type].solid : `border border-dashed ${TYPE_TONE[c.type].soft} border-current ${TYPE_TONE[c.type].text}`}`} />
                      ) : recupSet.has(date) ? (
                        <span className="mx-auto block h-5 w-full min-w-[18px] rounded bg-sky-500/70" />
                      ) : tag ? (
                        <span className={`mx-auto block h-2 w-2 rounded-full ${TAG_DOT[tag]}`} />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────────── Légende ────────────────────────────────── */

function TypePill({ type }: { type: CongeType }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_TONE[type].soft} ${TYPE_TONE[type].text}`}>
      {CONGE_TYPE_LABEL[type]}
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
      {(["cp", "rtt", "recup", "maladie", "sans_solde"] as CongeType[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-4 rounded-sm ${TYPE_TONE[t].solid}`} /> {CONGE_TYPE_LABEL[t]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm border border-dashed border-muted-foreground/60" /> en attente de validation
      </span>
    </div>
  );
}
