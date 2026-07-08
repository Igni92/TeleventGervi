"use client";

/**
 * GESTION HORAIRE HEBDOMADAIRE (onglet Effectifs).
 *
 * Chaque employé saisit ses heures RÉELLES dans un tableau Lun→Dim (matin +
 * après-midi) ; l'app calcule en direct l'écart au contrat, les heures supp
 * (majorations +25 % / +50 %) et la récupération (lib/heuresCalc, pur/testé).
 * Le profil (contrat hebdo + « journée type ») préremplit la semaine d'un clic.
 *
 * Le reporting est MENSUEL (carte « État mensuel ») : les managers
 * (admin/direction) y voient les totaux de toute l'équipe et sortent les
 * états signables en PDF (synthèse + un état par employé) pour la compta.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock3, ChevronLeft, ChevronRight, Loader2, Save, Printer, Wand2,
  CalendarDays, RotateCcw, Plus, Minus, Coins, CalendarCheck, SlidersHorizontal,
  Lock, Users,
} from "lucide-react";
import { toast } from "sonner";
import { SurfaceCard } from "@/components/ui/surface-card";
import { displayPersonName } from "@/lib/userNames";
import {
  JOURS_SEMAINE, DEFAULT_PROFILE, computeWeek, fmtHM,
  isoWeekId, shiftWeek, weekDates, weekLabel, isDateInWeek, daysAfterWeek,
  monthIdOf, shiftMonth, monthLabel,
  type DayHours, type HoursProfile, type WeekCalc, type MonthCalc, type HeuresOption,
} from "@/lib/heuresCalc";
import { printEtatMensuel, type MoisEmploye } from "@/lib/heuresPdf";

const EMPTY_WEEK = (): DayHours[] => Array.from({ length: 7 }, () => ({}));

/** État MENSUEL d'un employé : une ligne par semaine rattachée au mois
 *  (celle dont le dimanche tombe dans le mois) + agrégat. */
interface MonthRow {
  email: string;
  name: string;
  profile: HoursProfile | null;
  weeks: { week: string; calc: WeekCalc | null; option?: HeuresOption | null; recupDates?: string[] }[];
  total: MonthCalc;
}

export function HeuresPanel({ isManager }: { isManager: boolean }) {
  const [week, setWeek] = useState(() => isoWeekId(new Date()));
  const dates = useMemo(() => weekDates(week), [week]);

  // ── Le choix récup / paiement est une décision de l'EMPLOYEUR : verrouillé
  //    pour le salarié, modifiable seulement par un manager. Un manager peut en
  //    plus ouvrir la semaine d'un salarié (`who` = son e-mail ; "" = soi). ──
  const canEditOption = isManager;
  const [who, setWho] = useState("");
  const userQS = who ? `&user=${encodeURIComponent(who)}` : "";

  /* ── Ma semaine ── */
  const [days, setDays] = useState<DayHours[]>(EMPTY_WEEK());
  const [profile, setProfile] = useState<HoursProfile>({ ...DEFAULT_PROFILE, typicalDay: { ...DEFAULT_PROFILE.typicalDay } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── Option compta des heures supp de la semaine (récup / paiement) ──
  const [option, setOption] = useState<HeuresOption | null>(null);
  const [recupDates, setRecupDates] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/effectif/heures?week=${week}${userQS}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) {
        setDays(j.entry?.days ?? EMPTY_WEEK());
        setOption(j.entry?.option ?? null);
        setRecupDates(Array.isArray(j.entry?.recupDates) ? j.entry.recupDates.filter(Boolean) : []);
        if (j.profile) setProfile(j.profile);
        setDirty(false);
      }
    } finally {
      setLoading(false);
    }
  }, [week, userQS]);
  useEffect(() => { load(); }, [load]);

  const calc = useMemo(() => computeWeek(days, profile.weeklyHours), [days, profile.weeklyHours]);

  const setDay = (i: number, patch: Partial<DayHours>) => {
    setDays((cur) => cur.map((d, k) => (k === i ? { ...d, ...patch } : d)));
    setDirty(true);
  };

  // ── Options « heures supp » : à décider dès qu'il y a des supp (ou si un choix
  //    a déjà été saisi — on n'escamote jamais une donnée existante). ──
  const hasSupp = calc.sup25Min + calc.sup50Min > 0;
  const showOptions = hasSupp || option != null;

  // Semaine déjà AU CONTRAT (≥ 35 h faites) → on n'y pose pas de récup : elle se
  // prend sur une autre semaine. Un clic sur l'option active la désélectionne.
  const weekIsFull = calc.totalMin >= calc.contractMin && calc.contractMin > 0;

  const chooseOption = (opt: HeuresOption) => {
    if (!canEditOption) return;
    setOption((cur) => (cur === opt ? null : opt));
    setDirty(true);
  };

  // Ajout/retrait d'un jour de récup. INTERDIT dans la semaine des heures supp
  // (36h15 lun→ven ⇒ pas de récup le samedi de CETTE semaine) : la récup se pose
  // sur une autre semaine.
  const toggleRecupDay = (dateISO: string) => {
    if (!canEditOption || !dateISO) return;
    if (weekIsFull && isDateInWeek(dateISO, week)) {
      toast.error("Récup impossible cette semaine — le contrat y est déjà atteint. À poser sur une autre semaine.");
      return;
    }
    setRecupDates((cur) => (cur.includes(dateISO) ? cur.filter((d) => d !== dateISO) : [...cur, dateISO].sort()));
    setDirty(true);
  };

  // Journée type appliquée sur Lun→Ven aux jours encore VIDES.
  const applyTypical = () => {
    const t = profile.typicalDay;
    setDays((cur) => cur.map((d, i) => {
      if (i > 4) return d;
      const empty = !d.m1 && !d.m2 && !d.a1 && !d.a2;
      return empty ? { ...d, m1: t.m1, m2: t.m2, a1: t.a1, a2: t.a2 } : d;
    }));
    setDirty(true);
  };

  // ── APRÈS-MIDI MASQUÉE PAR DÉFAUT ──────────────────────────────────────────
  // On ne travaille que très rarement l'après-midi : les 2 plages « après-midi »
  // n'apparaissent qu'à la demande (toggle), pour alléger la saisie et tenir sur
  // un écran de téléphone. Elles réapparaissent D'OFFICE si une saisie après-midi
  // existe déjà (semaine chargée, journée type après-midi) → jamais de donnée cachée.
  const daysHaveAfternoon = useMemo(() => days.some((d) => !!(d?.a1 || d?.a2)), [days]);
  const profileHasAfternoon = !!(profile.typicalDay.a1 || profile.typicalDay.a2);
  const [wantAfternoon, setWantAfternoon] = useState(false);
  const showAfternoon = wantAfternoon || daysHaveAfternoon || profileHasAfternoon;

  const saveWeek = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/effectif/heures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week, days, user: who || undefined,
          // Le choix est renvoyé tel quel ; le SERVEUR ignore toute modif venant
          // d'un non-manager (la décision employeur déjà enregistrée est conservée).
          option,
          recupDates: option === "recup" ? recupDates.filter(Boolean) : [],
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'enregistrement des heures"); return; }
      setDirty(false);
      toast.success(`Heures enregistrées — ${weekLabel(week)}`);
      loadMonth();   // l'état mensuel reflète la semaine tout juste saisie
    } catch {
      toast.error("Échec de l'enregistrement des heures");
    } finally {
      setSaving(false);
    }
  };

  // Profil (contrat + journée type) — sauvegarde explicite.
  const [savingProfile, setSavingProfile] = useState(false);
  const saveProfil = async (next: HoursProfile) => {
    setProfile(next);
    setSavingProfile(true);
    try {
      const r = await fetch("/api/effectif/heures", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: next, user: who || undefined }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) toast.error(j?.error || "Échec de l'enregistrement du profil");
    } catch {
      toast.error("Échec de l'enregistrement du profil");
    } finally {
      setSavingProfile(false);
    }
  };

  /* ── ÉTAT MENSUEL (compta) : les heures supp restent calculées PAR SEMAINE,
        le mois n'est que la totalisation. Semaine à cheval → mois de son
        dimanche (les supp partent dans le mois suivant — paie au 10). ── */
  const [month, setMonth] = useState(() => monthIdOf(new Date()));
  const [myMonth, setMyMonth] = useState<MonthRow | null>(null);
  const [teamMonth, setTeamMonth] = useState<MonthRow[] | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const loadMonth = useCallback(async () => {
    setMonthLoading(true);
    try {
      const ownP = fetch(`/api/effectif/heures?month=${month}${userQS}`, { cache: "no-store" })
        .then((r) => r.json()).catch(() => null);
      const teamP = isManager
        ? fetch(`/api/effectif/heures?month=${month}&all=1`, { cache: "no-store" })
            .then((r) => r.json()).catch(() => null)
        : Promise.resolve(null);
      const [o, t] = await Promise.all([ownP, teamP]);
      if (o?.ok) setMyMonth({ email: o.email, name: o.name, profile: o.profile, weeks: o.weeks, total: o.total });
      if (isManager) setTeamMonth(t?.ok ? (t.rows ?? []) : []);
    } finally {
      setMonthLoading(false);
    }
  }, [month, isManager, userQS]);
  useEffect(() => { loadMonth(); }, [loadMonth]);

  const printMyMonth = () => {
    if (!myMonth) return;
    const ok = printEtatMensuel(month, [{
      name: "Mon état mensuel", email: myMonth.email,
      profile: myMonth.profile ?? { ...DEFAULT_PROFILE }, weeks: myMonth.weeks,
    }]);
    if (!ok) toast.error("Impression bloquée — autorisez les pop-ups.");
  };
  const toMois = (row: MonthRow): MoisEmploye => ({
    name: displayFullName(row.name), email: row.email,
    profile: row.profile ?? { ...DEFAULT_PROFILE }, weeks: row.weeks,
  });
  const printMonthOne = (row: MonthRow) => {
    if (row.total.weeksWithData === 0) { toast.info("Aucune saisie ce mois-ci pour cet employé."); return; }
    if (!printEtatMensuel(month, [toMois(row)])) toast.error("Impression bloquée — autorisez les pop-ups.");
  };
  const printMonthAll = () => {
    const feuilles = (teamMonth ?? []).filter((r) => r.total.weeksWithData > 0).map(toMois);
    if (feuilles.length === 0) { toast.info("Aucune saisie ce mois-ci."); return; }
    if (!printEtatMensuel(month, feuilles)) toast.error("Impression bloquée — autorisez les pop-ups.");
  };

  const timeCls = "h-9 w-full min-w-[74px] rounded-md border border-border bg-background px-1.5 text-[13px] tnum text-center focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50";
  // Inputs des cartes MOBILE : plus hauts (cible tactile), s'étirent sur la ligne.
  const timeCardCls = "h-10 flex-1 min-w-0 rounded-md border border-border bg-background px-1 text-[14px] tnum text-center focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50";

  return (
    <div className="space-y-4">
      {/* ── Ma semaine ── */}
      <SurfaceCard accent="emerald" title="Mes heures de la semaine" icon={<Clock3 className="h-3.5 w-3.5" />}
        action={
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setWeek((w) => shiftWeek(w, -1))} aria-label="Semaine précédente"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground px-1 whitespace-nowrap">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {/* Libellé court sur mobile (« Sem. 28 ») → l'en-tête ne déborde pas. */}
              <span className="hidden sm:inline">{weekLabel(week)}</span>
              <span className="sm:hidden">Sem. {week.slice(-2)}</span>
            </span>
            <button type="button" onClick={() => setWeek((w) => shiftWeek(w, 1))} aria-label="Semaine suivante"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
              <ChevronRight className="h-4 w-4" />
            </button>
            {week !== isoWeekId(new Date()) && (
              <button type="button" onClick={() => setWeek(isoWeekId(new Date()))} title="Revenir à la semaine en cours"
                className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        }>
        {/* Manager : ouvrir la semaine d'un salarié pour saisir/corriger ses
            heures et POSER la décision récup/paiement (réservée à l'employeur). */}
        {isManager && (teamMonth?.length ?? 0) > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <label htmlFor="rh-who" className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground shrink-0">Salarié</label>
            <select id="rh-who" value={who} onChange={(e) => setWho(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="">Mes heures</option>
              {(teamMonth ?? []).map((r) => (
                <option key={r.email} value={r.email}>{displayFullName(r.name)}</option>
              ))}
            </select>
            {who && <span className="hidden sm:inline text-[10.5px] font-semibold text-brand-700 dark:text-brand-300 whitespace-nowrap">édition employeur</span>}
          </div>
        )}

        {/* Profil : contrat hebdo + journée type (responsive : les blocs passent
            à la ligne sur mobile, le bouton « journée type » prend la largeur). */}
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
          <div>
            <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Contrat hebdo (h)</label>
            <input
              type="number" min={1} max={60} step={0.5} value={profile.weeklyHours}
              onChange={(e) => saveProfil({ ...profile, weeklyHours: Number(e.target.value) || DEFAULT_PROFILE.weeklyHours })}
              className="h-9 w-[84px] rounded-md border border-border bg-background px-2 text-[13.5px] tnum font-semibold focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Journée type — matin</label>
            <div className="flex items-center gap-1">
              <input type="time" value={profile.typicalDay.m1 ?? ""} onChange={(e) => saveProfil({ ...profile, typicalDay: { ...profile.typicalDay, m1: e.target.value } })} className={timeCls} />
              <span className="text-muted-foreground text-[12px]">→</span>
              <input type="time" value={profile.typicalDay.m2 ?? ""} onChange={(e) => saveProfil({ ...profile, typicalDay: { ...profile.typicalDay, m2: e.target.value } })} className={timeCls} />
            </div>
          </div>
          {/* Journée type après-midi : visible seulement quand l'après-midi est affichée. */}
          {showAfternoon && (
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Journée type — après-midi</label>
              <div className="flex items-center gap-1">
                <input type="time" value={profile.typicalDay.a1 ?? ""} onChange={(e) => saveProfil({ ...profile, typicalDay: { ...profile.typicalDay, a1: e.target.value } })} className={timeCls} />
                <span className="text-muted-foreground text-[12px]">→</span>
                <input type="time" value={profile.typicalDay.a2 ?? ""} onChange={(e) => saveProfil({ ...profile, typicalDay: { ...profile.typicalDay, a2: e.target.value } })} className={timeCls} />
              </div>
            </div>
          )}
          <button type="button" onClick={applyTypical}
            title="Préremplit Lundi→Vendredi (jours encore vides) avec la journée type"
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 w-full sm:w-auto rounded-md border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            <Wand2 className="h-3.5 w-3.5" /> Appliquer la journée type
          </button>
          {savingProfile && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mb-2.5" />}
        </div>

        {/* Barre : bascule « après-midi » (masquée par défaut). Désactivée quand une
            saisie après-midi existe déjà (on ne peut pas cacher des données réelles). */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Saisie <b className="text-foreground">du matin</b> par défaut.</span>
          <button
            type="button"
            onClick={() => setWantAfternoon((v) => !v)}
            disabled={daysHaveAfternoon || profileHasAfternoon}
            aria-pressed={showAfternoon}
            title={daysHaveAfternoon || profileHasAfternoon
              ? "Des heures d'après-midi sont saisies — l'après-midi reste affichée"
              : (showAfternoon ? "Masquer l'après-midi" : "Ajouter les heures de l'après-midi")}
            className={`inline-flex shrink-0 items-center gap-1.5 h-9 px-3 rounded-lg border text-[12px] font-semibold transition-colors disabled:opacity-60 ${
              showAfternoon
                ? "border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            {showAfternoon ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            Après-midi
          </button>
        </div>

        {/* MOBILE (< md) : une carte par jour — le tableau à 5-7 colonnes ne tient
            pas sur un téléphone. Matin toujours affiché, après-midi si activée. */}
        <div className="md:hidden space-y-2">
          {JOURS_SEMAINE.map((jour, i) => (
            <div key={jour} className={`rounded-lg border border-border p-3 ${i > 4 ? "bg-secondary/15" : "bg-background"}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[13.5px] font-semibold text-foreground">
                  {jour}
                  {dates[i] && (
                    <span className="ml-1.5 font-normal text-[11px] text-muted-foreground tnum">
                      {new Date(`${dates[i]}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })}
                    </span>
                  )}
                </span>
                <span className="text-[13.5px] font-bold tnum text-foreground">{calc.dayMin[i] > 0 ? fmtHM(calc.dayMin[i]) : "—"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-11 shrink-0 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Matin</span>
                <input type="time" disabled={loading} value={days[i]?.m1 ?? ""} onChange={(e) => setDay(i, { m1: e.target.value })} className={timeCardCls} aria-label={`${jour} matin début`} />
                <span className="text-muted-foreground text-[11px] shrink-0">→</span>
                <input type="time" disabled={loading} value={days[i]?.m2 ?? ""} onChange={(e) => setDay(i, { m2: e.target.value })} className={timeCardCls} aria-label={`${jour} matin fin`} />
              </div>
              {showAfternoon && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="w-11 shrink-0 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">A-midi</span>
                  <input type="time" disabled={loading} value={days[i]?.a1 ?? ""} onChange={(e) => setDay(i, { a1: e.target.value })} className={timeCardCls} aria-label={`${jour} après-midi début`} />
                  <span className="text-muted-foreground text-[11px] shrink-0">→</span>
                  <input type="time" disabled={loading} value={days[i]?.a2 ?? ""} onChange={(e) => setDay(i, { a2: e.target.value })} className={timeCardCls} aria-label={`${jour} après-midi fin`} />
                </div>
              )}
              <input value={days[i]?.note ?? ""} disabled={loading} maxLength={80}
                onChange={(e) => setDay(i, { note: e.target.value })}
                placeholder="Note (CP, récup, maladie…)"
                aria-label={`${jour} note`}
                className="mt-2 h-10 w-full rounded-md border border-border bg-background px-2.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50" />
            </div>
          ))}
        </div>

        {/* DESKTOP (≥ md) : tableau Lun→Dim. Colonnes après-midi conditionnelles. */}
        <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-semibold px-3 py-2">Jour</th>
                <th className="font-semibold px-2 py-2">Matin début</th>
                <th className="font-semibold px-2 py-2">Matin fin</th>
                {showAfternoon && <th className="font-semibold px-2 py-2">A-midi début</th>}
                {showAfternoon && <th className="font-semibold px-2 py-2">A-midi fin</th>}
                <th className="text-right font-semibold px-3 py-2">Total</th>
                <th className="text-left font-semibold px-3 py-2">Note (CP, récup…)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {JOURS_SEMAINE.map((jour, i) => (
                <tr key={jour} className={i > 4 ? "bg-secondary/15" : ""}>
                  <td className="px-3 py-1.5 font-semibold whitespace-nowrap">
                    {jour}
                    {dates[i] && (
                      <span className="ml-1.5 font-normal text-[11px] text-muted-foreground tnum">
                        {new Date(`${dates[i]}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.m1 ?? ""} onChange={(e) => setDay(i, { m1: e.target.value })} className={timeCls} aria-label={`${jour} matin début`} /></td>
                  <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.m2 ?? ""} onChange={(e) => setDay(i, { m2: e.target.value })} className={timeCls} aria-label={`${jour} matin fin`} /></td>
                  {showAfternoon && <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.a1 ?? ""} onChange={(e) => setDay(i, { a1: e.target.value })} className={timeCls} aria-label={`${jour} après-midi début`} /></td>}
                  {showAfternoon && <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.a2 ?? ""} onChange={(e) => setDay(i, { a2: e.target.value })} className={timeCls} aria-label={`${jour} après-midi fin`} /></td>}
                  <td className="px-3 py-1.5 text-right tnum font-bold">{calc.dayMin[i] > 0 ? fmtHM(calc.dayMin[i]) : "—"}</td>
                  <td className="px-3 py-1.5">
                    <input value={days[i]?.note ?? ""} disabled={loading} maxLength={80}
                      onChange={(e) => setDay(i, { note: e.target.value })}
                      placeholder=""
                      aria-label={`${jour} note`}
                      className="h-9 w-full min-w-[120px] rounded-md border border-border bg-background px-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── OPTIONS « heures supp » (récupération vs paiement) ──
            DÉCISION DE L'EMPLOYEUR : un manager choisit ; le salarié la voit en
            LECTURE SEULE. La récup se pose sur une AUTRE semaine (jamais sur la
            semaine des supp, déjà ≥ contrat). Mobile-first. */}
        {showOptions && (
          <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Heures supp — {canEditOption ? "que faire ?" : "décision de l'employeur"}
              </span>
              {!canEditOption && <Lock className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Réservé à l'employeur" />}
              {hasSupp && (
                <span className="ml-auto text-[11px] tnum font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                  {fmtHM(calc.sup25Min + calc.sup50Min)} supp
                </span>
              )}
            </div>

            {canEditOption ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <OptionChoice active={option === "recup"} onClick={() => chooseOption("recup")}
                    icon={<CalendarCheck className="h-4 w-4" />} label="Récupération" hint="en jours, autre semaine" />
                  <OptionChoice active={option === "paiement"} onClick={() => chooseOption("paiement")}
                    icon={<Coins className="h-4 w-4" />} label="Paiement" hint="des heures supp." />
                </div>

                {option === "recup" && (
                  <RecupDayPicker week={week} recupDates={recupDates} onToggle={toggleRecupDay} />
                )}

                <p className="mt-2.5 text-[11px] text-muted-foreground">
                  Le choix est reporté sur l&apos;état mensuel (PDF) transmis à la compta et au salarié.
                </p>
              </>
            ) : (
              /* Salarié : lecture seule — il voit la décision, il ne la pose pas. */
              <div className="text-[12.5px]">
                {option === "recup" ? (
                  <div>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-300">
                      <CalendarCheck className="h-3.5 w-3.5" /> Récupération{recupDates.length ? ` · ${recupDates.length} j` : ""}
                    </span>
                    {recupDates.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {recupDates.map((d) => (
                          <span key={d} className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11px] tnum text-foreground">{fmtDayShort(d)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : option === "paiement" ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                    <Coins className="h-3.5 w-3.5" /> Paiement des heures supp.
                  </span>
                ) : (
                  <span className="italic text-muted-foreground">En attente de la décision de l&apos;employeur.</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Totaux + actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge label="Total" value={fmtHM(calc.totalMin)} tone="foreground" />
          <Badge label="Contrat" value={fmtHM(calc.contractMin)} tone="muted" />
          {calc.sup25Min > 0 && <Badge label="Supp +25 %" value={fmtHM(calc.sup25Min)} tone="amber" />}
          {calc.sup50Min > 0 && <Badge label="Supp +50 %" value={fmtHM(calc.sup50Min)} tone="rose" />}
          {calc.majEquivMin > 0 && <Badge label="Équiv. payé" value={fmtHM(calc.majEquivMin)} tone="emerald" />}
          {calc.recupMin > 0 && <Badge label="Récup" value={fmtHM(calc.recupMin)} tone="sky" />}
          {/* Bouton pleine largeur sur mobile (grande cible), aligné à droite ≥ sm. */}
          <button type="button" onClick={saveWeek} disabled={saving || loading || !dirty}
            className="w-full sm:w-auto sm:ml-auto inline-flex items-center justify-center gap-1.5 h-11 sm:h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer mes heures
          </button>
        </div>
      </SurfaceCard>

      {/* ── ÉTAT MENSUEL (compta / paie) ── */}
      <SurfaceCard accent="amber" title={`État mensuel — ${monthLabel(month)}`} icon={<CalendarDays className="h-3.5 w-3.5" />}
        action={
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mois précédent"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
              <ChevronLeft className="h-4 w-4" />
            </button>
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
            {isManager && (
              <button type="button" onClick={printMonthAll} disabled={monthLoading}
                title="État mensuel de toute l'équipe (synthèse + un état signable par employé) — le document à envoyer à la compta pour la paie"
                className="ml-1 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[12.5px] font-semibold disabled:opacity-50 shrink-0">
                <Printer className="h-4 w-4 shrink-0" /> PDF <span className="hidden sm:inline">compta (tous)</span>
              </button>
            )}
          </div>
        }>
        {/* Mon mois : une ligne par semaine rattachée au mois */}
        {monthLoading && !myMonth ? (
          <p className="py-3 text-[13px] text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement du mois…
          </p>
        ) : myMonth && (
          <>
            {/* MOBILE (< md) : une carte par semaine + carte total. */}
            <div className="md:hidden space-y-2">
              {myMonth.weeks.map(({ week: w, calc: c, option: o, recupDates: rd }) => (
                <div key={w} className={`rounded-lg border border-border p-3 ${c ? "" : "opacity-60"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 inline-flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">{weekLabel(w)}</span>
                      {o && <OptionChip option={o} recupDates={rd} />}
                    </span>
                    <span className="text-[13.5px] font-bold tnum text-foreground shrink-0">{c ? fmtHM(c.totalMin) : <span className="text-[11px] font-normal italic text-muted-foreground">non saisi</span>}</span>
                  </div>
                  {c && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] tnum">
                      <span className={c.deltaMin > 0 ? "text-amber-600 dark:text-amber-400" : c.deltaMin < 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}>
                        Écart <b>{fmtHM(c.deltaMin)}</b>
                      </span>
                      {c.sup25Min > 0 && <span className="text-muted-foreground">+25 % <b className="text-foreground">{fmtHM(c.sup25Min)}</b></span>}
                      {c.sup50Min > 0 && <span className="text-muted-foreground">+50 % <b className="text-foreground">{fmtHM(c.sup50Min)}</b></span>}
                      {c.majEquivMin > 0 && <span className="text-emerald-700 dark:text-emerald-300">Équiv. payé <b>{fmtHM(c.majEquivMin)}</b></span>}
                      {c.recupMin > 0 && <span className="text-sky-600 dark:text-sky-400">Récup <b>{fmtHM(c.recupMin)}</b></span>}
                    </div>
                  )}
                </div>
              ))}
              <div className="rounded-lg border-2 border-border bg-secondary/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-bold text-foreground">Total du mois ({myMonth.total.weeksWithData}/{myMonth.weeks.length} sem.)</span>
                  <span className="text-[15px] font-bold tnum text-foreground">{fmtHM(myMonth.total.totalMin)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] tnum">
                  <span className="text-muted-foreground">Écart <b className="text-foreground">{fmtHM(myMonth.total.deltaMin)}</b></span>
                  {myMonth.total.sup25Min > 0 && <span className="text-muted-foreground">+25 % <b className="text-foreground">{fmtHM(myMonth.total.sup25Min)}</b></span>}
                  {myMonth.total.sup50Min > 0 && <span className="text-muted-foreground">+50 % <b className="text-foreground">{fmtHM(myMonth.total.sup50Min)}</b></span>}
                  {myMonth.total.majEquivMin > 0 && <span className="text-emerald-700 dark:text-emerald-300">Équiv. payé <b>{fmtHM(myMonth.total.majEquivMin)}</b></span>}
                  {myMonth.total.recupMin > 0 && <span className="text-sky-600 dark:text-sky-400">Récup <b>{fmtHM(myMonth.total.recupMin)}</b></span>}
                </div>
              </div>
            </div>

            {/* DESKTOP (≥ md) : tableau. */}
            <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left font-semibold px-3 py-2">Semaine</th>
                    <th className="text-right font-semibold px-2 py-2">Total</th>
                    <th className="text-right font-semibold px-2 py-2">Écart</th>
                    <th className="text-right font-semibold px-2 py-2">+25 %</th>
                    <th className="text-right font-semibold px-2 py-2">+50 %</th>
                    <th className="text-right font-semibold px-2 py-2">Équiv. payé</th>
                    <th className="text-right font-semibold px-3 py-2">Récup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {myMonth.weeks.map(({ week: w, calc: c, option: o, recupDates: rd }) => (
                    <tr key={w} className={c ? "" : "opacity-55"}>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          {weekLabel(w)}
                          {o && <OptionChip option={o} recupDates={rd} />}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tnum font-semibold">{c ? fmtHM(c.totalMin) : <span className="italic text-muted-foreground">non saisi</span>}</td>
                      <td className={`px-2 py-1.5 text-right tnum ${c && c.deltaMin > 0 ? "text-amber-600 dark:text-amber-400" : c && c.deltaMin < 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}>{c ? fmtHM(c.deltaMin) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{c && c.sup25Min > 0 ? fmtHM(c.sup25Min) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{c && c.sup50Min > 0 ? fmtHM(c.sup50Min) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum font-semibold text-emerald-700 dark:text-emerald-300">{c && c.majEquivMin > 0 ? fmtHM(c.majEquivMin) : "—"}</td>
                      <td className="px-3 py-1.5 text-right tnum">{c && c.recupMin > 0 ? fmtHM(c.recupMin) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-bold">
                    <td className="px-3 py-2">Total du mois ({myMonth.total.weeksWithData}/{myMonth.weeks.length} sem.)</td>
                    <td className="px-2 py-2 text-right tnum">{fmtHM(myMonth.total.totalMin)}</td>
                    <td className="px-2 py-2 text-right tnum">{fmtHM(myMonth.total.deltaMin)}</td>
                    <td className="px-2 py-2 text-right tnum">{fmtHM(myMonth.total.sup25Min)}</td>
                    <td className="px-2 py-2 text-right tnum">{fmtHM(myMonth.total.sup50Min)}</td>
                    <td className="px-2 py-2 text-right tnum text-emerald-700 dark:text-emerald-300">{fmtHM(myMonth.total.majEquivMin)}</td>
                    <td className="px-3 py-2 text-right tnum">{fmtHM(myMonth.total.recupMin)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-muted-foreground">
                Les heures supp restent calculées <b>par semaine civile</b> ; le mois n&apos;est que la totalisation.
                Une semaine à cheval sur deux mois est rattachée au mois où elle se termine (dimanche).
              </p>
              <button type="button" onClick={printMyMonth}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                <Printer className="h-4 w-4" /> Mon état mensuel (PDF)
              </button>
            </div>
          </>
        )}

        {/* Équipe (managers) : totaux mensuels par employé */}
        {isManager && (
          <div className="mt-4">
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">Équipe — totaux du mois</p>
            {monthLoading && !teamMonth ? (
              <p className="py-2 text-[13px] text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
              </p>
            ) : (
              <>
                {/* MOBILE (< md) : une carte par employé. */}
                <div className="md:hidden space-y-2">
                  {(teamMonth ?? []).map((row) => (
                    <div key={row.email} className={`rounded-lg border border-border p-3 ${row.total.weeksWithData > 0 ? "" : "opacity-60"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 text-[13px] font-semibold text-foreground truncate">
                          {displayFullName(row.name)}
                          {row.total.weeksWithData === 0 && <span className="ml-2 text-[9.5px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">non saisi</span>}
                        </span>
                        <span className="text-[13.5px] font-bold tnum text-foreground shrink-0">{row.total.weeksWithData > 0 ? fmtHM(row.total.totalMin) : "—"}</span>
                        <button type="button" onClick={() => printMonthOne(row)} disabled={row.total.weeksWithData === 0}
                          title="État mensuel PDF de cet employé"
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40">
                          <Printer className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] tnum">
                        <span className="text-muted-foreground">{row.total.weeksWithData}/{row.weeks.length} sem.</span>
                        <span className="text-muted-foreground">Contrat <b className="text-foreground">{fmtHM(row.total.contractMin)}</b></span>
                        {row.total.weeksWithData > 0 && (
                          <span className={row.total.deltaMin > 0 ? "text-amber-600 dark:text-amber-400" : row.total.deltaMin < 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}>
                            Écart <b>{fmtHM(row.total.deltaMin)}</b>
                          </span>
                        )}
                        {row.total.sup25Min > 0 && <span className="text-muted-foreground">+25 % <b className="text-foreground">{fmtHM(row.total.sup25Min)}</b></span>}
                        {row.total.sup50Min > 0 && <span className="text-muted-foreground">+50 % <b className="text-foreground">{fmtHM(row.total.sup50Min)}</b></span>}
                        {row.total.majEquivMin > 0 && <span className="text-emerald-700 dark:text-emerald-300">Équiv. payé <b>{fmtHM(row.total.majEquivMin)}</b></span>}
                        {row.total.recupMin > 0 && <span className="text-sky-600 dark:text-sky-400">Récup <b>{fmtHM(row.total.recupMin)}</b></span>}
                      </div>
                    </div>
                  ))}
                  {(teamMonth ?? []).length === 0 && (
                    <p className="px-1 py-4 text-[12.5px] italic text-muted-foreground">Aucun compte.</p>
                  )}
                </div>

                {/* DESKTOP (≥ md) : tableau. */}
                <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="text-left font-semibold px-3 py-2">Employé</th>
                        <th className="text-right font-semibold px-2 py-2">Sem.</th>
                        <th className="text-right font-semibold px-2 py-2">Contrat</th>
                        <th className="text-right font-semibold px-2 py-2">Total</th>
                        <th className="text-right font-semibold px-2 py-2">Écart</th>
                        <th className="text-right font-semibold px-2 py-2">+25 %</th>
                        <th className="text-right font-semibold px-2 py-2">+50 %</th>
                        <th className="text-right font-semibold px-2 py-2">Équiv. payé</th>
                        <th className="text-right font-semibold px-2 py-2">Récup</th>
                        <th className="text-right font-semibold px-3 py-2">PDF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {(teamMonth ?? []).map((row) => (
                        <tr key={row.email} className={row.total.weeksWithData > 0 ? "" : "opacity-55"}>
                          <td className="px-3 py-2 font-semibold whitespace-nowrap">
                            {displayFullName(row.name)}
                            {row.total.weeksWithData === 0 && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">non saisi</span>}
                          </td>
                          <td className="px-2 py-2 text-right tnum text-muted-foreground">{row.total.weeksWithData}/{row.weeks.length}</td>
                          <td className="px-2 py-2 text-right tnum text-muted-foreground">{fmtHM(row.total.contractMin)}</td>
                          <td className="px-2 py-2 text-right tnum font-bold">{row.total.weeksWithData > 0 ? fmtHM(row.total.totalMin) : "—"}</td>
                          <td className={`px-2 py-2 text-right tnum font-semibold ${row.total.deltaMin > 0 ? "text-amber-600 dark:text-amber-400" : row.total.deltaMin < 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}>
                            {row.total.weeksWithData > 0 ? fmtHM(row.total.deltaMin) : "—"}
                          </td>
                          <td className="px-2 py-2 text-right tnum">{row.total.sup25Min > 0 ? fmtHM(row.total.sup25Min) : "—"}</td>
                          <td className="px-2 py-2 text-right tnum">{row.total.sup50Min > 0 ? fmtHM(row.total.sup50Min) : "—"}</td>
                          <td className="px-2 py-2 text-right tnum font-semibold text-emerald-700 dark:text-emerald-300">{row.total.majEquivMin > 0 ? fmtHM(row.total.majEquivMin) : "—"}</td>
                          <td className="px-2 py-2 text-right tnum">{row.total.recupMin > 0 ? fmtHM(row.total.recupMin) : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" onClick={() => printMonthOne(row)} disabled={row.total.weeksWithData === 0}
                              title="État mensuel PDF de cet employé"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40">
                              <Printer className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {(teamMonth ?? []).length === 0 && (
                        <tr><td colSpan={10} className="px-3 py-4 text-[12.5px] italic text-muted-foreground">Aucun compte.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

/** Nom complet affichable (garde le nom tel quel, repli email lisible). */
function displayFullName(raw: string): string {
  if (raw.includes("@")) return displayPersonName(raw);
  return raw;
}

/** « 2026-07-13 » → « lun. 13/07 » (jour de récup). */
function fmtDayShort(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Sélecteur de jours de récup FACILE : jours cliquables des semaines suivantes
 *  (jamais la semaine des supp — déjà au contrat) + saisie d'une autre date.
 *  Un clic ajoute/retire le jour. */
function RecupDayPicker({ week, recupDates, onToggle }: {
  week: string; recupDates: string[]; onToggle: (d: string) => void;
}) {
  // Propositions = jours après la semaine (dimanches retirés), coupés à 8.
  const suggestions = daysAfterWeek(week, 12)
    .filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0)
    .slice(0, 8);
  const firstAllowed = daysAfterWeek(week, 1)[0];   // 1er jour hors semaine (min saisie)
  // Dates déjà retenues mais hors des propositions (dates plus lointaines).
  const extra = recupDates.filter((d) => !suggestions.includes(d)).sort();

  return (
    <div className="mt-3">
      <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
        Jours de récupération <span className="normal-case font-normal text-muted-foreground/80">— cliquez pour sélectionner</span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((d) => (
          <DayChip key={d} date={d} active={recupDates.includes(d)} onClick={() => onToggle(d)} />
        ))}
        {extra.map((d) => (
          <DayChip key={d} date={d} active onClick={() => onToggle(d)} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted-foreground">Autre date&nbsp;:</span>
        <input type="date" min={firstAllowed}
          onChange={(e) => { const v = e.target.value; if (v) onToggle(v); e.target.value = ""; }}
          aria-label="Ajouter une autre date de récupération"
          className="h-8 rounded-md border border-border bg-background px-2 text-[12.5px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Repos compensateur posé <b className="font-semibold">en dehors</b> de la semaine des heures supp.
      </p>
    </div>
  );
}

/** Puce « jour » toggle (récup) — cible tactile confortable, état sélectionné. */
function DayChip({ date, active, onClick }: { date: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border text-[12px] font-semibold tnum transition-colors ${
        active
          ? "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      }`}>
      {active && <CalendarCheck className="h-3 w-3 shrink-0" />}
      {fmtDayShort(date)}
    </button>
  );
}

/** Case d'option « heures supp » façon radio (icône + libellé + puce active).
 *  Grande cible tactile, pleine largeur sur mobile via le parent en grille. */
function OptionChoice({ active, onClick, icon, label, hint }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-brand-500/50 bg-brand-500/10"
          : "border-border bg-background hover:bg-secondary/50"
      }`}>
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
        active ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "bg-secondary text-muted-foreground"
      }`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={`block text-[13px] font-semibold leading-tight ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
        <span className="block text-[11px] text-muted-foreground leading-tight">{hint}</span>
      </span>
      <span className={`ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
        active ? "border-brand-500 bg-brand-500" : "border-border"
      }`}>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
    </button>
  );
}

/** Pastille compacte de l'option retenue (état mensuel à l'écran). */
function OptionChip({ option, recupDates }: { option: HeuresOption; recupDates?: string[] }) {
  const isRecup = option === "recup";
  const n = recupDates?.filter(Boolean).length ?? 0;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
      isRecup ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    }`}>
      {isRecup ? <CalendarCheck className="h-3 w-3" /> : <Coins className="h-3 w-3" />}
      {isRecup ? "Récup" : "Payé"}
      {isRecup && n > 0 && <span className="font-normal opacity-80">· {n} j</span>}
    </span>
  );
}

function Badge({ label, value, tone }: { label: string; value: string; tone: "foreground" | "muted" | "amber" | "rose" | "emerald" | "sky" }) {
  const cls: Record<string, string> = {
    foreground: "bg-foreground/10 text-foreground",
    muted: "bg-secondary text-muted-foreground",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${cls[tone]}`}>
      <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold opacity-80">{label}</span>
      <span className="text-[14px] font-bold tnum">{value}</span>
    </span>
  );
}

