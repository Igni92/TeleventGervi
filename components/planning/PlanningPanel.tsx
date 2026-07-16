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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays, ChevronLeft, ChevronRight, RotateCcw, Loader2, Send, Check, X,
  Users, Palmtree, Clock3, SlidersHorizontal, Save, Sun, Lightbulb,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { InfoHint } from "@/components/ui/info-hint";
import { displayPersonName } from "@/lib/userNames";
import {
  fmtHM, monthIdOf, shiftMonth, monthLabel, type DayTag, DAY_TAG_LABEL,
} from "@/lib/heuresCalc";
import {
  monthGridDays, expandOuvrables, monthEndISO, saturdaysInRange, splitLeaveRecupCp,
  resolveCalendarDay, DAY_CATEGORY_LABEL, type DayCategory,
} from "@/lib/planning";
import { frenchHolidayLabel } from "@/lib/livraison";
import { eventsByDate } from "@/lib/events";
import {
  CONGE_TYPE_LABEL, CONGE_STATUS_LABEL, congeDayCount, congeOrigin, rangesOverlap,
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
/* Teintes des pastilles ALLONGÉES du calendrier (une couleur par catégorie).
   `solid` = barre pleine (calendrier d'équipe) ; `soft`+`text`+`border` = la
   pastille lisible avec libellé (calendrier d'une personne). Le férié a sa
   propre couleur (orange), distincte de la maladie (ambre). */
const CAT_TONE: Record<DayCategory, { solid: string; soft: string; text: string; border: string }> = {
  present:    { solid: "bg-emerald-500", soft: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500/45" },
  ferie:      { solid: "bg-orange-500",  soft: "bg-orange-500/15",  text: "text-orange-700 dark:text-orange-300",   border: "border-orange-500/45" },
  cp:         { solid: "bg-violet-500",  soft: "bg-violet-500/15",  text: "text-violet-700 dark:text-violet-300",   border: "border-violet-500/45" },
  conges:     { solid: "bg-violet-500",  soft: "bg-violet-500/15",  text: "text-violet-700 dark:text-violet-300",   border: "border-violet-500/45" },
  rtt:        { solid: "bg-fuchsia-500", soft: "bg-fuchsia-500/15", text: "text-fuchsia-700 dark:text-fuchsia-300", border: "border-fuchsia-500/45" },
  recup:      { solid: "bg-sky-500",     soft: "bg-sky-500/15",     text: "text-sky-700 dark:text-sky-300",         border: "border-sky-500/45" },
  maladie:    { solid: "bg-amber-500",   soft: "bg-amber-500/15",   text: "text-amber-700 dark:text-amber-300",     border: "border-amber-500/45" },
  absent:     { solid: "bg-rose-500",    soft: "bg-rose-500/15",    text: "text-rose-700 dark:text-rose-300",       border: "border-rose-500/45" },
  sans_solde: { solid: "bg-zinc-400",    soft: "bg-zinc-400/15",    text: "text-zinc-600 dark:text-zinc-300",       border: "border-zinc-400/45" },
  autre:      { solid: "bg-zinc-400",    soft: "bg-zinc-400/15",    text: "text-zinc-600 dark:text-zinc-300",       border: "border-zinc-400/45" },
};
const STATUS_TONE: Record<CongeStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  refused: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  cancelled: "bg-secondary text-muted-foreground",
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
        {/* Libellé court sur mobile (« 07/2026 ») → l'en-tête ne déborde pas. */}
        <span className="hidden sm:inline">{monthLabel(month)}</span>
        <span className="sm:hidden tnum">{month.slice(5)}/{month.slice(0, 4)}</span>
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
        title={isSelf
          ? "Mon calendrier"
          : <span className="truncate max-w-[130px] sm:max-w-none">Calendrier — {fullName(person.name)}</span>}
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
        hint={`${fmtHM(recup.creditMin)} acquises (majorées +25/+50 %) · ${fmtHM(recup.debitMin)} prises${recup.plannedDates.length ? ` · ${recup.plannedDates.length} j posé(s) à venir` : ""}`} />
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
  // Hiérarchie (redesign) : la VALEUR est l'info importante (héros display) ;
  // l'explication (hint) est secondaire → derrière le « ? » au survol,
  // supprimée sur mobile (plus de doublon texte gris + title natif).
  return (
    <div className={`flex-1 min-w-[150px] rounded-lg border px-3 py-2 ${tones[tone]}`}>
      <p className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold opacity-80">
        {icon}{label}
        {hint && <InfoHint label={label} size={13}>{hint}</InfoHint>}
      </p>
      <p className="font-display text-[20px] font-bold tnum leading-tight text-foreground">{value}</p>
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
  // Événements commerciaux (Noël, 14 juillet, Saint-Valentin…) posés sur la grille.
  const eventMap = useMemo(() => eventsByDate(grid.map((g) => g.date)), [grid]);
  const [sel, setSel] = useState({ start: "", end: "" });
  // Le salarié pose ses CONGÉS ; la récup disponible est ensuite consommée
  // automatiquement en jours ENTIERS (découpe récup + CP à l'envoi, cf. submit).
  // La direction, elle, propose de la récup par défaut.
  const [type, setType] = useState<CongeType>(isDirection && !isSelf ? "recup" : "cp");
  const [note, setNote] = useState("");

  // ── Sélection de la plage — DEUX gestes qui cohabitent :
  //    • CLIC début / CLIC fin (souris, doigt, clavier) : 1ʳᵉ touche = jour
  //      seul ; touche sur un jour POSTÉRIEUR = fin de plage ; sinon on repart.
  //    • GLISSER — SOURIS UNIQUEMENT (PC) : on maintient et on étire. Au doigt
  //      il n'y a PAS de glisser : le geste reste réservé au scroll de la page.
  const canAct = isSelf || isDirection;   // un admin non-direction consulte
  const [dragging, setDragging] = useState(false);
  const anchorRef = useRef("");     // jour du mousedown souris ("" = pas de geste)
  const draggedRef = useRef(false); // vrai dès que la souris a couvert un autre jour
  // Vrai le temps d'un geste SOURIS : le « click » natif qui suit est alors
  // ignoré (déjà traité au relâchement) — évite une double sélection, sans
  // dépendre de `pointerType` sur l'évènement click (peu fiable, vieux Safari).
  const mouseGestureRef = useRef(false);

  const tapDay = (date: string) => {
    if (!canAct) return;
    setSel((cur) =>
      !cur.start || cur.end !== cur.start || date < cur.start
        ? { start: date, end: date }
        : { start: cur.start, end: date });
  };
  const tapDayRef = useRef(tapDay);
  tapDayRef.current = tapDay;

  // Glisser SOURIS UNIQUEMENT : on démarre au mousedown, on étire au survol,
  // on conclut au relâchement. Le clic simple (sans glisser) retombe sur tapDay.
  const beginDrag = (date: string) => {
    if (!canAct) return;
    anchorRef.current = date;
    draggedRef.current = false;
    mouseGestureRef.current = true;
    setDragging(true);
  };
  const dragOver = (clientX: number, clientY: number) => {
    const date = document.elementFromPoint(clientX, clientY)
      ?.closest?.("[data-date]")?.getAttribute("data-date");
    if (!date || !anchorRef.current) return;
    if (date !== anchorRef.current) draggedRef.current = true;
    if (!draggedRef.current) return;   // pas encore un vrai glisser
    const a = anchorRef.current;
    setSel({ start: date < a ? date : a, end: date > a ? date : a });
  };
  const endDrag = useCallback(() => {
    // Souris relâchée SANS avoir couvert d'autre jour = simple CLIC → la
    // logique « clic début / clic fin » s'applique.
    if (anchorRef.current && !draggedRef.current) tapDayRef.current(anchorRef.current);
    anchorRef.current = "";
    draggedRef.current = false;
    setDragging(false);
  }, []);
  // Relâchement HORS de la grille (souris sortie du calendrier) → fin propre.
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointerup", endDrag);
    return () => window.removeEventListener("pointerup", endDrag);
  }, [dragging, endDrag]);

  // Le mois change → la sélection ne pointe plus sur ce qu'on voit : reset.
  useEffect(() => {
    setSel({ start: "", end: "" });
    setDragging(false);
    anchorRef.current = "";
    draggedRef.current = false;
    mouseGestureRef.current = false;
  }, [month, person.email]);

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
  const inSel = (d: string) => sel.start && d >= sel.start && d <= sel.end;

  const ouvrables = sel.start ? expandOuvrables(sel.start, sel.end).length : 0;

  // DÉCOUPE AUTO récup + CP (à l'avantage du salarié) : quand le salarié pose des
  // CONGÉS PAYÉS et qu'il lui reste de la récup, on consomme d'abord la récup en
  // JOURS ENTIERS (floor(solde / journée type)), le reste part en CP. Les deux
  // demandes sont envoyées à la validation. Dimanches/fériés déjà hors décompte.
  const typDayMin = person.profile.typicalDayMin;
  const recupBalanceMin = person.counters.recup.balanceMin;
  const recupDaysAvail = typDayMin > 0 ? Math.floor(recupBalanceMin / typDayMin) : 0;
  const autoSplit = isSelf && type === "cp" && !!sel.start && recupDaysAvail >= 1
    ? splitLeaveRecupCp(sel.start, sel.end, recupDaysAvail)
    : null;
  // Samedi(s) restant en CP (jour ouvrable décompté mais non travaillé) — signalé.
  const cpSaturdays = autoSplit?.cp ? saturdaysInRange(autoSplit.cp.start, autoSplit.cp.end) : [];

  // Congés/récup du MOIS affiché (validés + en attente) — liste détaillée sous
  // le calendrier sur mobile (les pastilles disent « quoi », la liste dit
  // « quand & quel statut » sans avoir à ouvrir chaque jour).
  const monthEvents = useMemo(() => {
    const a = `${month}-01`, b = monthEndISO(month);
    return person.conges
      .filter((c) => (c.status === "approved" || c.status === "pending") && rangesOverlap(c.start, c.end, a, b))
      .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  }, [person.conges, month]);

  const submit = async () => {
    if (!sel.start) return;
    // DÉCOUPE AUTO (salarié, CP, récup entière dispo) : on envoie d'abord la
    // portion RÉCUP (jours entiers), puis la portion CP restante — deux demandes.
    if (autoSplit && (autoSplit.recup || autoSplit.cp)) {
      let ok = true;
      if (autoSplit.recup) ok = await onSubmit({ action: "request", type: "recup", start: autoSplit.recup.start, end: autoSplit.recup.end, note });
      if (ok && autoSplit.cp) ok = await onSubmit({ action: "request", type: "cp", start: autoSplit.cp.start, end: autoSplit.cp.end, note });
      if (ok) { setSel({ start: "", end: "" }); setNote(""); }
      return;
    }
    const base = { type, start: sel.start, end: sel.end, note };
    const ok = isSelf
      ? await onSubmit({ action: "request", ...base })
      : await onSubmit({ action: "propose", email: person.email, name: person.name, ...base });
    if (ok) { setSel({ start: "", end: "" }); setNote(""); }
  };

  return (
    <div>
      {/* Grille mensuelle — responsive : cellules centrées façon appli mobile
          (numéro + pastilles), barres pleines sur desktop. */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-7 bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
          {JOURS_COURTS.map((j, i) => (
            <div key={j} className="px-0.5 py-1.5 text-center font-semibold">
              {/* Une seule lettre sur mobile (largeur), 3 lettres ≥ sm. */}
              <span className="sm:hidden">{["L", "M", "M", "J", "V", "S", "D"][i]}</span>
              <span className="hidden sm:inline">{j}</span>
            </div>
          ))}
        </div>
        {/* Le glisser (souris) est géré par pointer events ; sur mobile aucun
            handler tactile n'est posé → le doigt scrolle la page normalement,
            la sélection se fait au clic début / clic fin (onClick). */}
        <div
          className="grid grid-cols-7 divide-x divide-y divide-border/60 border-t border-border/60 md:select-none"
          onPointerMove={(e) => { if (dragging && e.pointerType === "mouse") dragOver(e.clientX, e.clientY); }}
          onPointerUp={endDrag}
        >
          {grid.map(({ date, inMonth }) => {
            const dayNum = Number(date.slice(-2));
            const conges = byDate.get(date) ?? [];
            const approved = conges.filter((c) => c.status === "approved");
            const pending = conges.filter((c) => c.status === "pending");
            const tag = person.tags[date];
            const isToday = date === todayISO;
            const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
            // Seul le DIMANCHE est chômé (fond grisé) : le samedi est travaillé
            // dans l'entreprise → traité comme un jour de semaine normal.
            const weekend = dow === 0;
            const hasRecupDot = recupSet.has(date) && !approved.some((c) => c.type === "recup");
            const ferieLabel = frenchHolidayLabel(date);
            const events = eventMap.get(date) ?? [];
            // Pastille DOMINANTE du jour : férié → congé validé → tag → congé en
            // attente → récup posée → PRÉSENT PAR DÉFAUT (lun→ven). Une seule
            // pastille lisible, allongée, avec son libellé (CP, Récup, Présent…).
            const resolved = resolveCalendarDay({
              dow, inMonth, ferieLabel,
              approvedTypes: approved.map((c) => c.type),
              pendingTypes: pending.map((c) => c.type),
              tag, recupPosee: hasRecupDot,
            });
            // Sélection LIÉE : un seul bandeau continu (pas de bordure entre 2
            // jours). Un calque `-inset-px` déborde d'1 px et masque les traits
            // de grille entre cellules sélectionnées ; arrondi UNIQUEMENT aux
            // extrémités de la plage et en début/fin de ligne (lun / dim).
            const selected = inSel(date);
            const capL = selected && (date === sel.start || dow === 1);
            const capR = selected && (date === sel.end || dow === 0);
            return (
              <button
                key={date} type="button" data-date={date}
                // Souris : démarre un éventuel glisser (le clic simple retombe
                // sur tapDay au relâchement). Tactile/clavier : onClick → tapDay,
                // sauf juste après un geste souris (déjà traité au relâchement).
                onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button === 0) beginDrag(date); }}
                onClick={() => {
                  if (mouseGestureRef.current) { mouseGestureRef.current = false; return; }
                  tapDay(date);
                }}
                title={[
                  ferieLabel ? `Férié : ${ferieLabel}` : null,
                  ...approved.map((c) => `${CONGE_TYPE_LABEL[c.type]} (validé)`),
                  ...pending.map((c) => `${CONGE_TYPE_LABEL[c.type]} (en attente)`),
                  hasRecupDot ? "Récup posée" : null,
                  tag ? `Feuille d'heures : ${DAY_TAG_LABEL[tag]}` : null,
                  resolved.category === "present" ? "Présent (horaire par défaut)" : null,
                  ...events.map((e) => e.label),
                ].filter(Boolean).join(" · ") || undefined}
                className={`relative flex flex-col items-center md:items-start gap-1 min-h-[58px] sm:min-h-[70px] p-1 md:text-left transition-colors focus:outline-none focus:ring-1 focus:ring-brand-500 focus:z-20
                  ${inMonth ? "bg-background" : "bg-secondary/20 opacity-50"}
                  ${weekend && !ferieLabel ? "bg-secondary/10" : ""}
                  ${!selected && canAct ? "hover:bg-secondary/40" : ""}
                  ${!selected && !canAct ? "cursor-default" : ""}`}
              >
                {/* Bandeau de sélection continu : fond unique qui déborde d'1 px
                    pour masquer les traits de grille entre jours sélectionnés
                    (aucune bordure interne). Liseré haut+bas pour définir la
                    bande sans jamais séparer deux jours voisins ; arrondi + bord
                    latéral seulement aux extrémités (début/fin, lundi/dimanche). */}
                {selected && (
                  <span aria-hidden
                    className={`pointer-events-none absolute -inset-px z-0 bg-brand-500/25 border-y border-brand-500/60
                      ${capL ? "rounded-l-lg border-l" : ""} ${capR ? "rounded-r-lg border-r" : ""}`} />
                )}

                {/* Repère ÉVÉNEMENT (emoji) en haut à droite — Noël, 14 juillet… */}
                {events.length > 0 && (
                  <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 z-20 text-[11px] leading-none">
                    {events[0].emoji}
                  </span>
                )}

                {/* Ligne du numéro : centré (mobile) / à gauche (desktop).
                    Marqueur « aujourd'hui » : pastille arrondie (rounded-md),
                    même langage de forme que la sélection et les pastilles —
                    plus de rond isolé au milieu des rectangles. */}
                <span className="relative z-10 flex w-full items-center justify-center md:justify-start">
                  <span className={`inline-flex items-center justify-center rounded-md font-semibold tnum h-6 w-6 text-[12.5px] md:h-5 md:w-5 md:text-[11px]
                    ${isToday ? "bg-brand-500 text-white shadow-sm" : "text-foreground"}`}>
                    {dayNum}
                  </span>
                </span>

                {/* PASTILLE allongée + lisible : libellé de la catégorie du jour. */}
                {resolved.category && (
                  <DayPill category={resolved.category} pending={resolved.pending} planned={resolved.planned} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* MOBILE : détail des congés du mois (les pastilles disent « quoi », cette
          liste dit « quand & quel statut »). Tap → sélectionne la plage. */}
      {monthEvents.length > 0 && (
        <div className="md:hidden mt-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Ce mois-ci</p>
          {monthEvents.map((c) => (
            <button key={c.id} type="button"
              onClick={() => { if (canAct) setSel({ start: c.start, end: c.end }); }}
              className={`w-full flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left ${canAct ? "active:bg-secondary/40" : "cursor-default"}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.status === "approved" ? TYPE_TONE[c.type].solid : `border-2 border-current ${TYPE_TONE[c.type].text}`}`} />
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_TONE[c.type].soft} ${TYPE_TONE[c.type].text}`}>{CONGE_TYPE_LABEL[c.type]}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] tnum text-foreground">{rangeLabel(c)}</span>
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[c.status]}`}>{CONGE_STATUS_LABEL[c.status]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Demande / proposition sur la sélection */}
      {canAct && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            {isSelf ? "Demander (validé par la direction)" : "Proposer à ce salarié (il accepte ou refuse)"}
            {/* PC : glisser OU clic début/clic fin. Mobile : clic début/clic fin. */}
            <span className="normal-case font-normal text-muted-foreground/80">
              <span className="hidden md:inline"> — glissez sur les jours, ou cliquez le 1ᵉʳ puis le dernier</span>
              <span className="md:hidden"> — touchez le 1ᵉʳ jour puis le dernier</span>
            </span>
          </p>

          {/* APERÇU DÉCOUPE AUTO (salarié) : la récup se consomme en jours ENTIERS
              avant les CP. Deux demandes seront envoyées à la validation. */}
          {autoSplit && autoSplit.recup && (
            <div className="mb-2.5 flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-2.5">
              <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
              <p className="min-w-0 flex-1 text-[12px] text-sky-800 dark:text-sky-200">
                Ta récup (<b className="font-semibold tnum">{fmtHM(recupBalanceMin)}</b>) couvre <b className="font-semibold">{autoSplit.recupDays} jour{autoSplit.recupDays > 1 ? "s" : ""} entier{autoSplit.recupDays > 1 ? "s" : ""}</b> → à l&apos;envoi&nbsp;:{" "}
                <b className="font-semibold">{autoSplit.recupDays} j en récup</b>
                {autoSplit.cp ? <> + <b className="font-semibold">{autoSplit.cpDays} j en CP</b> (2 demandes)</> : <> (tout couvert, tes CP sont préservés)</>}.
                {cpSaturdays.length > 0 && <span className="opacity-80"> Dont {cpSaturdays.length} samedi{cpSaturdays.length > 1 ? "s" : ""} en CP.</span>}
              </p>
            </div>
          )}

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
              <input type="date" value={sel.start} onChange={(e) => setSel((c) => ({ start: e.target.value, end: !c.end || c.end < e.target.value ? e.target.value : c.end }))}
                className="h-9 rounded-md border border-border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Au</label>
              <input type="date" value={sel.end} min={sel.start || undefined} onChange={(e) => setSel((c) => ({ ...c, end: e.target.value }))}
                className="h-9 rounded-md border border-border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Précision (facultatif)"
              className="h-9 flex-1 min-w-[140px] rounded-md border border-border bg-background px-2.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500" />
            {/* Pleine largeur sur mobile (grande cible tactile), inline ≥ sm. */}
            <button type="button" onClick={submit} disabled={busy || !sel.start}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-11 sm:h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isSelf ? "Demander" : "Proposer"}
            </button>
          </div>
          {sel.start && (
            <p className="mt-2 text-[11.5px] text-muted-foreground tnum">
              {rangeLabel({ start: sel.start, end: sel.end })} · <span className="font-semibold text-foreground">{ouvrables}</span> jour{ouvrables > 1 ? "s" : ""} ouvrable{ouvrables > 1 ? "s" : ""} <span className="normal-case">(hors dimanches et fériés)</span>
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
  // Fériés (chômés pour TOUTE l'équipe) + événements — calculés une fois, posés
  // sur la colonne du jour (en-tête + fond de colonne).
  const ferieByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const { date } of days) { const l = frenchHolidayLabel(date); if (l) m.set(date, l); }
    return m;
  }, [days]);
  const eventMap = useMemo(() => eventsByDate(days.map((g) => g.date)), [days]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="border-collapse text-[12px] w-full">
        <thead>
          <tr className="bg-secondary/40 text-[9.5px] uppercase tracking-wide text-muted-foreground">
            <th className="sticky left-0 z-10 bg-secondary/40 text-left font-semibold px-3 py-2 min-w-[150px]">Employé · compteurs</th>
            {days.map(({ date }) => {
              const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
              const ferie = ferieByDate.get(date);
              const ev = eventMap.get(date)?.[0];
              return (
                <th key={date} title={[ferie ? `Férié : ${ferie}` : null, ev?.label].filter(Boolean).join(" · ") || undefined}
                  className={`px-0.5 py-1 text-center font-semibold min-w-[24px] ${date === todayISO ? "text-brand-600 dark:text-brand-400" : ""} ${ferie ? "bg-orange-500/15" : dow === 0 ? "bg-secondary/50" : ""}`}>
                  <span className="block tnum">{Number(date.slice(-2))}</span>
                  {ev && <span aria-hidden className="block text-[10px] leading-none">{ev.emoji}</span>}
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
                  const ferie = ferieByDate.get(date);
                  const recupPosee = recupSet.has(date) && !(c?.status === "approved" && c.type === "recup");
                  // Même résolution que le calendrier individuel : férié → congé
                  // → tag → en attente → récup posée → PRÉSENT PAR DÉFAUT.
                  const resolved = resolveCalendarDay({
                    dow, inMonth: true, ferieLabel: ferie,
                    approvedTypes: c?.status === "approved" ? [c.type] : [],
                    pendingTypes: c?.status === "pending" ? [c.type] : [],
                    tag, recupPosee,
                  });
                  const cat = resolved.category;
                  const title = ferie
                    ? `Férié : ${ferie}`
                    : c ? `${fullName(p.name)} — ${CONGE_TYPE_LABEL[c.type]} (${c.status === "approved" ? "validé" : "en attente"})`
                    : recupPosee ? `${fullName(p.name)} — récup posée`
                    : tag ? `${fullName(p.name)} — ${DAY_TAG_LABEL[tag]}`
                    : cat === "present" ? `${fullName(p.name)} — présent` : undefined;
                  return (
                    <td key={date} title={title}
                      className={`h-9 px-0.5 text-center align-middle ${ferie ? "bg-orange-500/10" : dow === 0 ? "bg-secondary/30" : ""} ${date === todayISO ? "outline outline-1 -outline-offset-1 outline-brand-500/40" : ""}`}>
                      {cat === "present" ? (
                        // Présence = ligne de fond discrète (ne surcharge pas la grille).
                        <span className="mx-auto block h-1.5 w-full min-w-[18px] rounded-full bg-emerald-500/40" />
                      ) : cat === "ferie" ? (
                        <span className="mx-auto block h-1.5 w-full min-w-[18px] rounded-full bg-orange-500/50" />
                      ) : cat ? (
                        <span className={`mx-auto block h-5 w-full min-w-[18px] rounded ${resolved.pending || resolved.planned ? `border border-dashed ${CAT_TONE[cat].soft} border-current ${CAT_TONE[cat].text}` : CAT_TONE[cat].solid}`} />
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

/** Libellé COURT (mobile) — la case d'un téléphone est étroite ; on abrège pour
 *  que la pastille reste ENTIÈRE (pas de « … »). Desktop garde le libellé plein. */
const CAT_SHORT: Record<DayCategory, string> = {
  present: "Prés.", ferie: "Férié", cp: "CP", rtt: "RTT", recup: "Récup",
  maladie: "Mal.", absent: "Abs.", sans_solde: "SS", autre: "Autre", conges: "Congé",
};

/** Pastille ALLONGÉE et LISIBLE d'une case du calendrier : barre pleine largeur
 *  portant le libellé de la catégorie (CP, Récup, Présent, Férié…). Un congé en
 *  attente (ou une récup posée à venir) est rendu en pointillés. Libellé abrégé
 *  sur mobile (case étroite), plein dès `md`. */
function DayPill({ category, pending, planned }: { category: DayCategory; pending: boolean; planned: boolean }) {
  const tone = CAT_TONE[category];
  const dashed = pending || planned;
  const isPresent = category === "present";
  // Hiérarchie visuelle (le « juste milieu ») : la PRÉSENCE (état normal, tous
  // les jours ouvrés) reste EN FILIGRANE — pastille très douce, sans bordure,
  // texte allégé — pour ne pas noyer le calendrier de vert. Les EXCEPTIONS (CP,
  // récup, férié, absence, maladie) ressortent en pastille pleine colorée.
  // « En attente / posé » garde le contour en pointillés.
  const cls = dashed
    ? `border border-dashed bg-transparent font-semibold ${tone.text} ${tone.border}`
    : isPresent
      ? "bg-emerald-500/[0.07] font-medium text-emerald-700/80 dark:text-emerald-300/80"
      : `${tone.soft} font-semibold ${tone.text}`;
  return (
    <span
      title={DAY_CATEGORY_LABEL[category]}
      className={`relative z-10 block w-full max-w-[76px] md:max-w-none truncate rounded-md px-1 py-[3px] text-center text-[10px] md:text-[11px] leading-tight tracking-tight transition-colors ${cls}`}
    >
      <span className="md:hidden">{CAT_SHORT[category]}</span>
      <span className="hidden md:inline">{DAY_CATEGORY_LABEL[category]}{planned && !pending ? " ·" : ""}</span>
    </span>
  );
}

function Legend() {
  // « Présent » et « Férié » d'abord (les plus fréquents), puis les types de congé.
  const cats: DayCategory[] = ["present", "cp", "rtt", "recup", "maladie", "absent", "ferie"];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
      {cats.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-4 rounded-sm ${CAT_TONE[c].solid}`} /> {DAY_CATEGORY_LABEL[c]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm border border-dashed border-muted-foreground/60" /> en attente / posé
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden>🎄</span> événement
      </span>
    </div>
  );
}
