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
  Lock, Users, X, AlertTriangle, Scale,
} from "lucide-react";
import { toast } from "sonner";
import { SurfaceCard } from "@/components/ui/surface-card";
import { displayPersonName } from "@/lib/userNames";
import {
  JOURS_SEMAINE, DEFAULT_PROFILE, computeWeek, fmtHM, typicalDayMinutes,
  isoWeekId, shiftWeek, weekDates, weekLabel, isDateInWeek, daysAfterWeek,
  monthIdOf, shiftMonth, monthLabel, DAY_TAGS, DAY_TAG_LABEL,
  splitSupp, effectivePaySuppMin,
  type DayHours, type DayTag, type HoursProfile, type WeekCalc, type MonthCalc, type HeuresOption,
} from "@/lib/heuresCalc";
import { frenchHolidayLabel } from "@/lib/livraison";
import type { MonthRecap } from "@/lib/planning";
import { printEtatMensuel, type MoisEmploye } from "@/lib/heuresPdf";

const EMPTY_WEEK = (): DayHours[] => Array.from({ length: 7 }, () => ({}));

/** Des heures réelles sont-elles saisies ce jour ? (plage complète matin OU
 *  après-midi) — sinon un tag « Congés » crédite la journée type. */
const dayHasHours = (d?: DayHours) => !!((d?.m1 && d?.m2) || (d?.a1 && d?.a2));

/** État MENSUEL d'un employé : une ligne par semaine rattachée au mois
 *  (celle dont le dimanche tombe dans le mois) + agrégat + récap compteurs
 *  (solde récup fin de mois, plafond, « à payer M+1 », CP). */
interface MonthRow {
  email: string;
  name: string;
  profile: HoursProfile | null;
  weeks: { week: string; calc: WeekCalc | null; option?: HeuresOption | null; paySuppMin?: number | null; recupDates?: string[] }[];
  total: MonthCalc;
  recap?: MonthRecap | null;
}

export function HeuresPanel({ isManager }: { isManager: boolean }) {
  const [week, setWeek] = useState(() => isoWeekId(new Date()));
  const dates = useMemo(() => weekDates(week), [week]);
  // Libellés des jours fériés de la semaine (« Fête nationale »…), par jour.
  const feries = useMemo(() => dates.map((d) => (d ? frenchHolidayLabel(d) : null)), [dates]);

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

  // ── Option compta des heures supp de la semaine (récup / paiement / mixte) ──
  const [option, setOption] = useState<HeuresOption | null>(null);
  const [paySuppMin, setPaySuppMin] = useState<number | null>(null);
  const [recupDates, setRecupDates] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/effectif/heures?week=${week}${userQS}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) {
        const loaded: DayHours[] = j.entry?.days ?? EMPTY_WEEK();
        // JOUR FÉRIÉ lun→ven encore VIDE (ni heures ni tag) → tag « Férié »
        // proposé d'office (journée type due) ; il ne persiste qu'à l'enregistrement
        // et reste retirable d'un clic (jour réellement travaillé).
        const wd = weekDates(week);
        let autoTagged = false;
        const merged = loaded.map((d, i) => {
          if (i > 4 || !wd[i] || !frenchHolidayLabel(wd[i])) return d;
          const empty = !d?.m1 && !d?.m2 && !d?.a1 && !d?.a2 && !d?.tag;
          if (!empty) return d;
          autoTagged = true;
          return { ...d, tag: "ferie" as DayTag };
        });
        setDays(merged);
        setOption(j.entry?.option ?? null);
        setPaySuppMin(typeof j.entry?.paySuppMin === "number" ? j.entry.paySuppMin : null);
        setRecupDates(Array.isArray(j.entry?.recupDates) ? j.entry.recupDates.filter(Boolean) : []);
        if (j.profile) setProfile(j.profile);
        setDirty(autoTagged);
      }
    } finally {
      setLoading(false);
    }
  }, [week, userQS]);
  useEffect(() => { load(); }, [load]);

  // Journée type (minutes) : la valeur CRÉDITÉE pour un jour taggé « Congés »
  // (un CP validé compte comme travaillé — il ne crée jamais de déficit).
  const typDayMin = useMemo(() => typicalDayMinutes(profile), [profile]);
  const calc = useMemo(() => computeWeek(days, profile.weeklyHours, typDayMin), [days, profile.weeklyHours, typDayMin]);

  const setDay = (i: number, patch: Partial<DayHours>) => {
    setDays((cur) => cur.map((d, k) => (k === i ? { ...d, ...patch } : d)));
    setDirty(true);
  };

  // Tag du jour (Présent / Absent / Congés / Récup / Maladie) — un seul par
  // jour, re-cliquer le tag actif le retire.
  const setTag = (i: number, tag: DayTag) => {
    setDays((cur) => cur.map((d, k) => (k === i ? { ...d, tag: d?.tag === tag ? undefined : tag } : d)));
    setDirty(true);
  };

  // ── Options « heures supp » : la récup/paiement ne concerne QUE des heures
  //    supp. Sans supp (les 35 h faites sans dépassement) → RIEN à récupérer :
  //    on masque le bloc et le serveur annule toute récup au recalcul. ──
  const hasSupp = calc.sup25Min + calc.sup50Min > 0;
  const showOptions = hasSupp;

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
          // Sans heures supp, aucune récup possible → on n'envoie rien (le serveur
          // annule de toute façon). Sinon le choix est renvoyé tel quel (le serveur
          // ignore une modif venant d'un non-manager).
          option: hasSupp ? option : null,
          paySuppMin: hasSupp && option === "mixte" ? paySuppMin : undefined,
          recupDates: hasSupp && (option === "recup" || option === "mixte") ? recupDates.filter(Boolean) : [],
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
      if (o?.ok) setMyMonth({ email: o.email, name: o.name, profile: o.profile, weeks: o.weeks, total: o.total, recap: o.recap });
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
      recap: myMonth.recap ?? null,
    }]);
    if (!ok) toast.error("Impression bloquée — autorisez les pop-ups.");
  };
  const toMois = (row: MonthRow): MoisEmploye => ({
    name: displayFullName(row.name), email: row.email,
    profile: row.profile ?? { ...DEFAULT_PROFILE }, weeks: row.weeks,
    recap: row.recap ?? null,
  });

  // ── DÉTAIL COMPTA pré-PDF : s'il y a des heures supp à arbitrer, on passe par
  //    un écran de détail PAR EMPLOYÉ (payer un bout, laisser le reste en récup)
  //    avant de générer le PDF. Sans heures supp → impression directe. ──
  const [comptaRows, setComptaRows] = useState<MonthRow[] | null>(null);
  const openCompta = (rows: MonthRow[]) => {
    const withData = rows.filter((r) => r.total.weeksWithData > 0);
    if (withData.length === 0) { toast.info("Aucune saisie ce mois-ci."); return; }
    const hasSupp = withData.some((r) => r.weeks.some((w) => w.calc && w.calc.sup25Min + w.calc.sup50Min > 0));
    if (!hasSupp) {
      if (!printEtatMensuel(month, withData.map(toMois))) toast.error("Impression bloquée — autorisez les pop-ups.");
      return;
    }
    setComptaRows(withData);
  };
  const printMonthOne = (row: MonthRow) => {
    if (row.total.weeksWithData === 0) { toast.info("Aucune saisie ce mois-ci pour cet employé."); return; }
    openCompta([row]);
  };
  const printMonthAll = () => openCompta(teamMonth ?? []);

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
                <span className="min-w-0 text-[13.5px] font-semibold text-foreground">
                  {jour}
                  {dates[i] && (
                    <span className="ml-1.5 font-normal text-[11px] text-muted-foreground tnum">
                      {new Date(`${dates[i]}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })}
                    </span>
                  )}
                  {feries[i] && (
                    <span className="ml-1.5 inline-flex items-center rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300">
                      Férié · {feries[i]}
                    </span>
                  )}
                </span>
                <span className="text-[13.5px] font-bold tnum text-foreground shrink-0">{calc.dayMin[i] > 0 ? fmtHM(calc.dayMin[i]) : "—"}</span>
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
              {/* Tags du jour (remplacent la note libre sur mobile) : Présent /
                  Absent / Congés / Récup / Maladie. « Congés » CRÉDITE une
                  journée type (le CP compte comme travaillé). */}
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`${jour} tag`}>
                {DAY_TAGS.map((t) => (
                  <TagChip key={t} tag={t} active={days[i]?.tag === t} disabled={loading} onClick={() => setTag(i, t)} />
                ))}
              </div>
              {days[i]?.tag === "conges" && !dayHasHours(days[i]) && typDayMin > 0 && (
                <p className="mt-1.5 text-[11px] text-sky-700 dark:text-sky-300">
                  Journée type créditée : <b className="tnum">{fmtHM(typDayMin)}</b> — le congé compte comme travaillé.
                </p>
              )}
              {days[i]?.tag === "ferie" && !dayHasHours(days[i]) && typDayMin > 0 && (
                <p className="mt-1.5 text-[11px] text-orange-700 dark:text-orange-300">
                  Journée type créditée : <b className="tnum">{fmtHM(typDayMin)}</b> — jour férié dû et payé.
                </p>
              )}
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
                <th className="text-left font-semibold px-2 py-2">Tag</th>
                <th className="text-left font-semibold px-3 py-2">Note</th>
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
                    {feries[i] && (
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400" title={`Jour férié — ${feries[i]}`}>
                        {feries[i]}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.m1 ?? ""} onChange={(e) => setDay(i, { m1: e.target.value })} className={timeCls} aria-label={`${jour} matin début`} /></td>
                  <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.m2 ?? ""} onChange={(e) => setDay(i, { m2: e.target.value })} className={timeCls} aria-label={`${jour} matin fin`} /></td>
                  {showAfternoon && <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.a1 ?? ""} onChange={(e) => setDay(i, { a1: e.target.value })} className={timeCls} aria-label={`${jour} après-midi début`} /></td>}
                  {showAfternoon && <td className="px-2 py-1.5"><input type="time" disabled={loading} value={days[i]?.a2 ?? ""} onChange={(e) => setDay(i, { a2: e.target.value })} className={timeCls} aria-label={`${jour} après-midi fin`} /></td>}
                  <td className="px-3 py-1.5 text-right tnum font-bold">
                    {calc.dayMin[i] > 0 ? fmtHM(calc.dayMin[i]) : "—"}
                    {days[i]?.tag === "conges" && !dayHasHours(days[i]) && typDayMin > 0 && (
                      <span className="ml-1 align-middle text-[9px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400" title="Journée type créditée — le congé compte comme travaillé">CP</span>
                    )}
                    {days[i]?.tag === "ferie" && !dayHasHours(days[i]) && typDayMin > 0 && (
                      <span className="ml-1 align-middle text-[9px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400" title="Journée type créditée — jour férié dû et payé">FÉRIÉ</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={days[i]?.tag ?? ""} disabled={loading} aria-label={`${jour} tag`}
                      onChange={(e) => setDay(i, { tag: (e.target.value || undefined) as DayTag | undefined })}
                      className="h-9 w-[110px] rounded-md border border-border bg-background px-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50">
                      <option value="">—</option>
                      {DAY_TAGS.map((t) => <option key={t} value={t}>{DAY_TAG_LABEL[t]}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input value={days[i]?.note ?? ""} disabled={loading} maxLength={80}
                      onChange={(e) => setDay(i, { note: e.target.value })}
                      placeholder=""
                      aria-label={`${jour} note`}
                      className="h-9 w-full min-w-[110px] rounded-md border border-border bg-background px-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50" />
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

                {/* Partage « mixte » posé depuis le détail compta (pré-PDF) : une
                    partie payée, le reste en récup. Cliquer une option ci-dessus
                    remplace le partage. */}
                {option === "mixte" && <MixteSummary calc={calc} paySuppMin={paySuppMin} />}

                {(option === "recup" || option === "mixte") && (
                  <RecupDayPicker week={week} recupDates={recupDates} onToggle={toggleRecupDay} />
                )}

                <p className="mt-2.5 text-[11px] text-muted-foreground">
                  Le choix est reporté sur l&apos;état mensuel (PDF) transmis à la compta et au salarié.
                  Le partage fin (payer une partie, le reste en récup) se pose depuis le bouton
                  «&nbsp;PDF compta&nbsp;» de l&apos;état mensuel.
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
                ) : option === "mixte" ? (
                  <MixteSummary calc={calc} paySuppMin={paySuppMin} />
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
          {calc.congesMin > 0 && <Badge label="Congés crédités" value={fmtHM(calc.congesMin)} tone="violet" />}
          {calc.ferieMin > 0 && <Badge label="Férié crédité" value={fmtHM(calc.ferieMin)} tone="orange" />}
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
                      {o && c && c.sup25Min + c.sup50Min > 0 && <OptionChip option={o} recupDates={rd} />}
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
                      {(c.ferieMin ?? 0) > 0 && <span className="text-orange-600 dark:text-orange-400">Férié <b>{fmtHM(c.ferieMin)}</b></span>}
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
                  {(myMonth.total.ferieMin ?? 0) > 0 && <span className="text-orange-600 dark:text-orange-400">Férié <b>{fmtHM(myMonth.total.ferieMin)}</b></span>}
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
                    <th className="text-right font-semibold px-2 py-2">Férié</th>
                    <th className="text-right font-semibold px-3 py-2">Récup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {myMonth.weeks.map(({ week: w, calc: c, option: o, recupDates: rd }) => (
                    <tr key={w} className={c ? "" : "opacity-55"}>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          {weekLabel(w)}
                          {o && c && c.sup25Min + c.sup50Min > 0 && <OptionChip option={o} recupDates={rd} />}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tnum font-semibold">{c ? fmtHM(c.totalMin) : <span className="italic text-muted-foreground">non saisi</span>}</td>
                      <td className={`px-2 py-1.5 text-right tnum ${c && c.deltaMin > 0 ? "text-amber-600 dark:text-amber-400" : c && c.deltaMin < 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}>{c ? fmtHM(c.deltaMin) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{c && c.sup25Min > 0 ? fmtHM(c.sup25Min) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{c && c.sup50Min > 0 ? fmtHM(c.sup50Min) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum font-semibold text-emerald-700 dark:text-emerald-300">{c && c.majEquivMin > 0 ? fmtHM(c.majEquivMin) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum text-orange-600 dark:text-orange-400">{c && (c.ferieMin ?? 0) > 0 ? fmtHM(c.ferieMin) : "—"}</td>
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
                    <td className="px-2 py-2 text-right tnum text-orange-600 dark:text-orange-400">{fmtHM(myMonth.total.ferieMin)}</td>
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
                        {(row.total.ferieMin ?? 0) > 0 && <span className="text-orange-600 dark:text-orange-400">Férié <b>{fmtHM(row.total.ferieMin)}</b></span>}
                        {row.total.recupMin > 0 && <span className="text-sky-600 dark:text-sky-400">Récup <b>{fmtHM(row.total.recupMin)}</b></span>}
                        {row.recap && <span className="text-muted-foreground">Solde récup <b className="text-foreground">{fmtHM(row.recap.recupBalanceMin)}</b></span>}
                        {(row.recap?.excessMin ?? 0) > 0 && (
                          <span className="text-rose-600 dark:text-rose-400 font-semibold" title="Heures de récup au-delà du plafond — payées sur le bulletin du mois suivant">
                            Payé M+1 <b>{fmtHM(row.recap!.excessMin)}</b>
                          </span>
                        )}
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
                        <th className="text-right font-semibold px-2 py-2">Férié</th>
                        <th className="text-right font-semibold px-2 py-2">Récup</th>
                        <th className="text-right font-semibold px-2 py-2" title="Heures de récup au-delà du plafond employeur — payées sur le bulletin du mois suivant">Payé M+1</th>
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
                          <td className="px-2 py-2 text-right tnum text-orange-600 dark:text-orange-400">{(row.total.ferieMin ?? 0) > 0 ? fmtHM(row.total.ferieMin) : "—"}</td>
                          <td className="px-2 py-2 text-right tnum">{row.total.recupMin > 0 ? fmtHM(row.total.recupMin) : "—"}</td>
                          <td className={`px-2 py-2 text-right tnum font-semibold ${(row.recap?.excessMin ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
                            {(row.recap?.excessMin ?? 0) > 0 ? fmtHM(row.recap!.excessMin) : "—"}
                          </td>
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
                        <tr><td colSpan={12} className="px-3 py-4 text-[12.5px] italic text-muted-foreground">Aucun compte.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </SurfaceCard>

      {/* Détail compta pré-PDF : arbitrage paiement / récup des heures supp,
          par employé, AVANT de générer l'état mensuel. */}
      {comptaRows && (
        <ComptaDialog
          month={month}
          rows={comptaRows}
          onClose={() => setComptaRows(null)}
          onDone={() => { load(); loadMonth(); }}
        />
      )}
    </div>
  );
}

/** Nom complet affichable (garde le nom tel quel, repli email lisible). */
function displayFullName(raw: string): string {
  if (raw.includes("@")) return displayPersonName(raw);
  return raw;
}

/* ────────────────── Détail compta pré-PDF (managers) ──────────────────────
 * Avant de générer l'état mensuel, l'employeur arbitre les heures supp de
 * chaque semaine, PAR EMPLOYÉ : tout payer, tout en récup, ou MIXTE (payer un
 * bout, laisser le reste en récup). Le solde de récup PROJETÉ est recalculé en
 * direct, et on alerte si la récup DÉJÀ POSÉE (jours validés pas encore
 * débités) n'est plus couverte — elle reste ajustable ici avant d'imprimer. */

interface ComptaDecision { option: HeuresOption | ""; payH: string }

const decKey = (email: string, week: string) => `${email}|${week}`;

/** Saisie « heures à payer » (décimal, virgule tolérée) → minutes bornées aux supp. */
function payInputToMin(payH: string, suppMin: number): number {
  const h = Number(String(payH).replace(",", ".").trim());
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.min(Math.round(h * 60), suppMin);
}

/** Équivalent MAJORÉ crédité au compteur de récup pour une décision donnée. */
function recupEquivOf(c: WeekCalc, option: HeuresOption | "" | null | undefined, payMin: number): number {
  if (option !== "recup" && option !== "mixte") return 0;
  return splitSupp(c.sup25Min, c.sup50Min, payMin).recupEquivMin;
}

function ComptaDialog({ month, rows, onClose, onDone }: {
  month: string;
  rows: MonthRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ComptaDecision>>(() => {
    const out: Record<string, ComptaDecision> = {};
    for (const r of rows) {
      for (const w of r.weeks) {
        if (!w.calc || w.calc.sup25Min + w.calc.sup50Min <= 0) continue;
        out[decKey(r.email, w.week)] = {
          option: w.option ?? "",
          payH: w.option === "mixte" && w.paySuppMin ? String(Math.round((w.paySuppMin / 60) * 100) / 100) : "",
        };
      }
    }
    return out;
  });
  const setDecision = (key: string, patch: Partial<ComptaDecision>) =>
    setDecisions((cur) => ({ ...cur, [key]: { ...cur[key], ...patch } }));

  const generate = async () => {
    setBusy(true);
    try {
      // 1. Enregistre les décisions MODIFIÉES (PATCH — ne touche pas aux jours).
      for (const r of rows) {
        for (const w of r.weeks) {
          if (!w.calc) continue;
          const supp = w.calc.sup25Min + w.calc.sup50Min;
          if (supp <= 0) continue;
          const d = decisions[decKey(r.email, w.week)];
          if (!d) continue;
          const newOpt = d.option || null;
          const newPay = d.option === "mixte" ? payInputToMin(d.payH, supp) : undefined;
          const savedPay = w.option === "mixte" ? (w.paySuppMin ?? 0) : undefined;
          if (newOpt === (w.option ?? null) && (newOpt !== "mixte" || newPay === savedPay)) continue;
          const res = await fetch("/api/effectif/heures", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ week: w.week, user: r.email, option: newOpt, paySuppMin: newPay }),
          });
          const j = await res.json().catch(() => null);
          if (!res.ok || !j?.ok) throw new Error(j?.error || `Échec d'enregistrement — ${displayFullName(r.name)}, ${w.week}`);
        }
      }
      // 2. Recharge le mois (décisions incluses) puis génère le PDF.
      const res = await fetch(`/api/effectif/heures?month=${month}&all=1`, { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.error || "Rechargement du mois impossible");
      const wanted = new Set(rows.map((x) => x.email));
      const feuilles: MoisEmploye[] = ((j.rows ?? []) as MonthRow[])
        .filter((x) => wanted.has(x.email) && x.total.weeksWithData > 0)
        .map((x) => ({
          name: displayFullName(x.name), email: x.email,
          profile: x.profile ?? { ...DEFAULT_PROFILE }, weeks: x.weeks, recap: x.recap ?? null,
        }));
      if (feuilles.length === 0) { toast.info("Aucune saisie ce mois-ci."); return; }
      if (!printEtatMensuel(month, feuilles)) { toast.error("Impression bloquée — autorisez les pop-ups."); return; }
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement des décisions");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-6"
      role="dialog" aria-modal="true" aria-label="Détail compta avant PDF">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">Avant le PDF compta — {monthLabel(month)}</p>
            <h2 className="text-[15px] font-bold text-foreground">Heures supp : payer ou récupérer ?</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Par employé et par semaine : tout payer, tout en récup, ou <b>mixte</b> (payer une partie,
              le reste crédite le compteur de récup). Seul le dépassement <b>travaillé</b> s&apos;arbitre —
              les jours fériés sont <b>toujours payés</b>, à part. Reporté tel quel sur le PDF.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"
            className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {rows.map((r) => {
            const prof = r.profile ?? { ...DEFAULT_PROFILE };
            const typDay = typicalDayMinutes(prof);
            const suppWeeks = r.weeks.filter((w) => w.calc && w.calc.sup25Min + w.calc.sup50Min > 0);
            if (suppWeeks.length === 0) return null;

            // Solde de récup PROJETÉ = solde fin de mois recalculé avec les
            // décisions du dialogue (crédit retiré quand on bascule au paiement).
            const delta = suppWeeks.reduce((s, w) => {
              const c = w.calc!;
              const supp = c.sup25Min + c.sup50Min;
              const d = decisions[decKey(r.email, w.week)];
              const newEq = d ? recupEquivOf(c, d.option, d.option === "mixte" ? payInputToMin(d.payH, supp) : 0) : 0;
              const savedEq = recupEquivOf(c, w.option, effectivePaySuppMin(w.option, w.paySuppMin, supp));
              return s + (newEq - savedEq);
            }, 0);
            const balance = (r.recap?.recupBalanceMin ?? 0) + delta;
            const plannedDays = r.recap?.plannedRecupDates?.length ?? 0;
            const plannedMin = plannedDays * typDay;
            const pendingDays = r.recap?.pendingRecupDays ?? 0;
            const shortfall = plannedMin > balance;

            return (
              <div key={r.email} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-foreground">{displayFullName(r.name)}</span>
                  <span className="text-[11.5px] tnum text-muted-foreground">
                    Solde récup projeté <b className={balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}>{fmtHM(balance)}</b>
                    {plannedDays > 0 && <> · posée à venir <b className="text-foreground">{plannedDays} j ({fmtHM(plannedMin)})</b></>}
                    {pendingDays > 0 && <> · demandée <b className="text-foreground">{pendingDays} j</b></>}
                  </span>
                </div>

                {/* Fériés : TOUJOURS payés, détaillés à part — aucun arbitrage possible. */}
                {(r.total.ferieMin ?? 0) > 0 && (
                  <p className="mt-1 text-[11.5px] tnum text-orange-700 dark:text-orange-300">
                    Fériés du mois : <b>{fmtHM(r.total.ferieMin)}</b> — toujours payés, hors arbitrage.
                  </p>
                )}

                {/* Récup déjà posée/demandée pas encore débitée : si le paiement
                    vide trop le compteur, on prévient AVANT de générer le PDF. */}
                {(shortfall || balance < 0) && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      {balance < 0
                        ? <>Le solde de récup projeté est <b>négatif</b> — réduisez la part payée.</>
                        : <>La récup déjà posée ({plannedDays} j = {fmtHM(plannedMin)}) ne serait plus couverte
                          par le solde projeté ({fmtHM(balance)}) — ajustez la part payée ou les jours posés.</>}
                    </span>
                  </p>
                )}

                <div className="mt-2 space-y-2">
                  {suppWeeks.map((w) => {
                    const c = w.calc!;
                    const supp = c.sup25Min + c.sup50Min;
                    const key = decKey(r.email, w.week);
                    const d = decisions[key] ?? { option: "", payH: "" };
                    const payMin = d.option === "paiement" ? supp : d.option === "mixte" ? payInputToMin(d.payH, supp) : 0;
                    const split = splitSupp(c.sup25Min, c.sup50Min, payMin);
                    return (
                      <div key={w.week} className="rounded-md border border-border/70 bg-secondary/15 px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 text-[12px] font-semibold text-foreground">{weekLabel(w.week)}</span>
                          <span className="text-[11.5px] tnum font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">{fmtHM(supp)} supp</span>
                          <select
                            value={d.option}
                            disabled={busy}
                            onChange={(e) => setDecision(key, { option: e.target.value as HeuresOption | "" })}
                            aria-label={`Décision ${weekLabel(w.week)}`}
                            className="h-8 rounded-md border border-border bg-background px-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50">
                            <option value="">— à décider</option>
                            <option value="paiement">Tout payer</option>
                            <option value="recup">Tout en récup</option>
                            <option value="mixte">Mixte (partager)</option>
                          </select>
                        </div>
                        {d.option === "mixte" && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <label className="text-[11px] text-muted-foreground" htmlFor={`pay-${key}`}>Heures payées</label>
                            <input
                              id={`pay-${key}`} type="number" inputMode="decimal" min={0} max={Math.round((supp / 60) * 100) / 100} step={0.25}
                              value={d.payH} disabled={busy}
                              onChange={(e) => setDecision(key, { payH: e.target.value })}
                              placeholder="ex. 1,5"
                              className="h-8 w-[88px] rounded-md border border-border bg-background px-2 text-[12.5px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
                            />
                            <span className="text-[11.5px] tnum text-muted-foreground">
                              → payé <b className="text-emerald-700 dark:text-emerald-300">{fmtHM(split.payMin)}</b>
                              <span className="opacity-75"> (équiv. {fmtHM(split.payEquivMin)})</span>
                              {" · "}récup <b className="text-sky-700 dark:text-sky-300">{fmtHM(split.recupMin)}</b>
                              <span className="opacity-75"> (équiv. {fmtHM(split.recupEquivMin)})</span>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="inline-flex items-center justify-center h-10 px-4 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
            Annuler
          </button>
          <button type="button" onClick={generate} disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Enregistrer &amp; générer le PDF
          </button>
        </div>
      </div>
    </div>
  );
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

/** Puce TAG de journée (mobile) — Présent / Absent / Congés / Récup / Maladie.
 *  Un seul tag par jour ; re-cliquer le tag actif le retire. */
const TAG_TONE: Record<DayTag, string> = {
  present: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  absent: "border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  conges: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  recup: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  maladie: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ferie: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300",
};

function TagChip({ tag, active, disabled, onClick }: { tag: DayTag; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`inline-flex items-center h-9 px-2.5 rounded-lg border text-[12px] font-semibold transition-colors disabled:opacity-50 ${
        active ? TAG_TONE[tag] : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      }`}>
      {DAY_TAG_LABEL[tag]}
    </button>
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

/** Résumé du partage « mixte » d'une semaine (X payées / Y en récup, avec les
 *  équivalents majorés) — affiché sous les options et en lecture seule salarié. */
function MixteSummary({ calc, paySuppMin }: { calc: WeekCalc; paySuppMin: number | null }) {
  const supp = calc.sup25Min + calc.sup50Min;
  const split = splitSupp(calc.sup25Min, calc.sup50Min, effectivePaySuppMin("mixte", paySuppMin, supp));
  return (
    <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
        <Scale className="h-3.5 w-3.5" /> Partage posé (détail compta)
      </span>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 tnum text-[12px]">
        <span className="text-emerald-700 dark:text-emerald-300">Payées <b>{fmtHM(split.payMin)}</b> <span className="opacity-75">(équiv. {fmtHM(split.payEquivMin)})</span></span>
        <span className="text-sky-700 dark:text-sky-300">En récup <b>{fmtHM(split.recupMin)}</b> <span className="opacity-75">(équiv. {fmtHM(split.recupEquivMin)})</span></span>
      </div>
    </div>
  );
}

/** Pastille compacte de l'option retenue (état mensuel à l'écran). */
function OptionChip({ option, recupDates }: { option: HeuresOption; recupDates?: string[] }) {
  const n = recupDates?.filter(Boolean).length ?? 0;
  if (option === "mixte") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">
        <Scale className="h-3 w-3" /> Mixte
        {n > 0 && <span className="font-normal opacity-80">· {n} j</span>}
      </span>
    );
  }
  const isRecup = option === "recup";
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

function Badge({ label, value, tone }: { label: string; value: string; tone: "foreground" | "muted" | "amber" | "rose" | "emerald" | "sky" | "violet" | "orange" }) {
  // Recette CANONIQUE du design system (bg /12 + ring /25 + variante sombre).
  // Les tons à sens métier passent par les tokens sémantiques (success/warning/
  // info) ; les tons purement catégoriels gardent leur teinte littérale.
  const cls: Record<string, string> = {
    foreground: "bg-foreground/10 text-foreground ring-1 ring-foreground/15",
    muted: "bg-secondary text-muted-foreground ring-1 ring-border",
    amber: "bg-warning/12 text-warning ring-1 ring-warning/25",
    rose: "bg-destructive/12 text-destructive ring-1 ring-destructive/25",
    emerald: "bg-success/12 text-success ring-1 ring-success/25",
    sky: "bg-info/12 text-info ring-1 ring-info/25",
    violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/25",
    orange: "bg-orange-500/12 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/25",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${cls[tone]}`}>
      <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold opacity-80">{label}</span>
      <span className="text-[14px] font-bold tnum">{value}</span>
    </span>
  );
}

