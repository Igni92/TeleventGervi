"use client";

/**
 * ÉLÉMENTS DES SALAIRES (onglet /salaires) — DEUX ÉTATS distincts :
 *
 *   • SAISIE (admin/direction, « ergonomique ») : une carte REPLIABLE par
 *     salarié — l'en-tête résume (heures, alertes), le détail ne s'ouvre qu'au
 *     clic : primes, frais, note, fiche paie (CDI / 13e mois / véhicule → AN)
 *     derrière un second pli. Largeur bornée, mobile épuré.
 *   • ÉTAT COMPTABLE (« professionnel », cf. ComptaStatement) : document sobre
 *     en lecture seule, mois par mois (liste déroulante), imprimable — la vue
 *     du cabinet, accessible à l'admin par l'onglet du haut.
 *
 * L'app RAPPELLE les éléments manquants avant transmission ; le récapitulatif
 * part par email au cabinet comptable en un clic.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, ChevronDown, RotateCcw, Loader2, Save, Send, Plus, Trash2,
  Wallet, AlertTriangle, Car, Gift, ReceiptText, CheckCircle2, KeyRound, FileSpreadsheet, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { SurfaceCard } from "@/components/ui/surface-card";
import { fmtHM, monthIdOf, shiftMonth, monthLabel } from "@/lib/heuresCalc";
import {
  avantageNatureMensuel, isTreiziemeMonth, prorata13e,
  VEHICULE_ENERGIES, VEHICULE_ENERGIE_LABEL,
  type SalaryFrais, type SalaryHeures, type SalaryMonthData, type SalaryPrime,
  type SalaryProfile, type VehiculeAN, type VehiculeEnergie,
} from "@/lib/salaires";
import { ComptaStatement } from "./ComptaStatement";

interface Row {
  email: string;
  name: string;
  heures: SalaryHeures;
  salary: SalaryMonthData | null;
  profile: SalaryProfile | null;
  anMensuel: number;
  prorata13: number | null;
  missing: string[];
}
interface ApiData {
  ok: boolean; month: string; rows: Row[];
  sent: { sentAt: string; sentBy: string; to: string[] } | null;
  canEdit: boolean;
  /** L'accès par mot de passe du cabinet comptable est-il configuré ? */
  comptaConfigured?: boolean;
}

const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const newId = () => Math.random().toString(36).slice(2, 10);

/* ─────────────── Vue racine : saisie (admin) OU état comptable ────────────── */

export function SalairesView({ canEdit }: { canEdit: boolean }) {
  // Cabinet comptable (lecture seule) → directement l'état professionnel,
  // avec sa barre de navigation (profil confiné : pas de menu d'app).
  const [tab, setTab] = useState<"saisie" | "etat">("saisie");
  if (!canEdit) return <ComptaStatement showNav />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      {/* Onglets : la SAISIE du mois (ergonomique) / l'ÉTAT comptable (document). */}
      <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-0.5">
        <TabButton active={tab === "saisie"} onClick={() => setTab("saisie")} icon={<Pencil className="h-3.5 w-3.5" />} label="Saisie du mois" />
        <TabButton active={tab === "etat"} onClick={() => setTab("etat")} icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="État comptable" />
      </div>
      {tab === "saisie" ? <SalairesPanel canEdit /> : <ComptaStatement showNav={false} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[13px] font-semibold transition-colors ${
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}>
      {icon}{label}
    </button>
  );
}

/* ─────────────────────────── Saisie du mois (admin) ───────────────────────── */

export function SalairesPanel({ canEdit }: { canEdit: boolean }) {
  const [month, setMonth] = useState(() => monthIdOf(new Date()));
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/salaires?month=${month}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ApiData | null;
      if (j?.ok) setData(j);
      else toast.error((j as { error?: string } | null)?.error || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => r.heures.weeksWithData > 0
      || (r.salary && (r.salary.primes.length > 0 || r.salary.frais.length > 0))
      || r.profile?.vehicule || r.profile?.treizieme),
    [data],
  );
  const missingTotal = rows.reduce((s, r) => s + r.missing.length, 0);

  const sendRecap = async () => {
    if (missingTotal > 0 && !window.confirm(
      `${missingTotal} élément(s) manquant(s) — envoyer quand même le récap au comptable ?`)) return;
    setSending(true);
    try {
      const r = await fetch("/api/salaires", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", month }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Envoi impossible"); return; }
      toast.success("Récapitulatif envoyé au cabinet comptable.");
      await load();
    } catch { toast.error("Envoi impossible — réseau ?"); }
    finally { setSending(false); }
  };

  const monthNav = (
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
    </div>
  );

  return (
    <div className="space-y-3">
      <SurfaceCard accent="amber" title={`Paie — ${monthLabel(month)}`} icon={<Wallet className="h-3.5 w-3.5" />} action={monthNav}>
        {/* RAPPEL avant transmission : ce qui manque encore, employé par employé. */}
        {missingTotal > 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" /> À compléter avant transmission au cabinet comptable
            </p>
            <ul className="mt-1 space-y-0.5 text-[12px] text-amber-800 dark:text-amber-200">
              {rows.filter((r) => r.missing.length > 0).map((r) => (
                <li key={r.email}><b>{r.name}</b> — {r.missing.join(" · ")}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {data?.sent ? (
            <p className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Récap envoyé le {new Date(data.sent.sentAt).toLocaleDateString("fr-FR")}
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Récapitulatif de {monthLabel(month)} pas encore transmis.
            </p>
          )}
          {canEdit && (
            <button type="button" onClick={sendRecap} disabled={sending || loading || rows.length === 0}
              className="w-full sm:w-auto sm:ml-auto inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-semibold disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {data?.sent ? "Renvoyer au comptable" : "Envoyer au comptable"}
            </button>
          )}
        </div>
        {loading && (
          <p className="mt-2 text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…
          </p>
        )}

        {/* Accès du cabinet (boîte partagée sans SSO) : mot de passe dédié. */}
        {canEdit && data && <ComptaAccess configured={!!data.comptaConfigured} onChanged={load} />}
      </SurfaceCard>

      {rows.map((r) => (
        <EmployeeCard key={`${r.email}:${month}`} row={r} month={month} canEdit={canEdit} onSaved={load} />
      ))}
      {!loading && rows.length === 0 && (
        <p className="px-1 py-3 text-[12.5px] italic text-muted-foreground">Aucune donnée ce mois-ci.</p>
      )}
    </div>
  );
}

/* ───────────── Accès du cabinet comptable (mot de passe dédié) ────────────── */

/** Mot de passe fort généré côté client (18 caractères, alphabet sans ambigus). */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!#%+*";
  const bytes = new Uint32Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function ComptaAccess({ configured, onChanged }: { configured: boolean; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/salaires", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setComptaPassword", password }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'enregistrement du mot de passe"); return; }
      toast.success("Mot de passe comptable enregistré — transmettez-le au cabinet.");
      setOpen(false);
      setPassword("");
      await onChanged();
    } catch { toast.error("Échec de l'enregistrement du mot de passe"); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Accès cabinet comptable —</span> compta@gervifrais.com
        </p>
        <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
          configured ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
        }`}>
          {configured ? "mot de passe configuré" : "mot de passe NON configuré"}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
          {configured ? "Changer le mot de passe" : "Définir le mot de passe"}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 12 caractères" autoComplete="off" spellCheck={false}
            className="h-9 flex-1 min-w-[200px] rounded-md border border-border bg-background px-2 text-[12.5px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500"
            aria-label="Nouveau mot de passe comptable"
          />
          <button type="button" onClick={() => setPassword(generatePassword())}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            Générer
          </button>
          <button type="button" onClick={save} disabled={saving || password.length < 12}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
          </button>
          <p className="w-full text-[11px] text-muted-foreground">
            Connexion séparée de Microsoft (boîte partagée) : le cabinet passe par « Accès cabinet
            comptable » sur la page de login — planning + éléments des salaires uniquement, sans
            devenir membre de l&apos;effectif. Notez le mot de passe AVANT d&apos;enregistrer.
          </p>
        </div>
      )}
    </div>
  );
}

/* ───────────── Carte d'un salarié — REPLIABLE (l'en-tête résume) ──────────── */

function EmployeeCard({ row, month, canEdit, onSaved }: {
  row: Row; month: string; canEdit: boolean; onSaved: () => Promise<void>;
}) {
  const h = row.heures;
  const [open, setOpen] = useState(false);
  const [primes, setPrimes] = useState<SalaryPrime[]>(row.salary?.primes ?? []);
  const [frais, setFrais] = useState<SalaryFrais[]>(row.salary?.frais ?? []);
  const [note, setNote] = useState(row.salary?.note ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const has13e = primes.some((p) => /13e|13è|treizi/i.test(p.motif));
  const show13eHint = canEdit && !!row.profile?.treizieme && isTreiziemeMonth(month) && !has13e;
  // Prorata du ½ 13e mois : recalculé en direct depuis la fiche (date CDI).
  const p13 = prorata13e(row.profile?.cdiDate, month);
  const primesTotal = primes.reduce((s, p) => s + p.montant, 0);

  const patchPrime = (id: string, patch: Partial<SalaryPrime>) => {
    setPrimes((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  };
  const patchFrais = (id: string, patch: Partial<SalaryFrais>) => {
    setFrais((cur) => cur.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/salaires", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, user: row.email, primes, frais, note }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'enregistrement"); return; }
      setDirty(false);
      toast.success(`Éléments enregistrés — ${row.name}`);
      await onSaved();
    } catch { toast.error("Échec de l'enregistrement"); }
    finally { setSaving(false); }
  };

  const inputCls = "h-10 rounded-md border border-border bg-background px-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* EN-TÊTE repliable : le résumé suffit tant qu'on n'édite pas. */}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-secondary/30 transition-colors">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-foreground">{row.name}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] tnum text-muted-foreground">
            <span>Heures <b className="text-foreground">{fmtHM(h.totalMin)}</b></span>
            {h.suppPayEquivMin > 0 && <span className="text-emerald-700 dark:text-emerald-300">Supp payées <b>{fmtHM(h.suppPayEquivMin)}</b></span>}
            {h.suppSansDecisionMin > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400">Supp sans décision</span>}
            {primesTotal > 0 && <span className="hidden sm:inline">Primes <b className="text-foreground">{eur(primesTotal)}</b></span>}
            {row.anMensuel > 0 && <span className="hidden sm:inline">AN <b className="text-foreground">{eur(row.anMensuel)}</b></span>}
          </span>
        </span>
        {row.missing.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> {row.missing.length}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3.5 space-y-4">
          {/* Heures du mois (reprises de la saisie) — détail complet. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-secondary/20 px-3 py-2 text-[12px] tnum">
            <span className="text-muted-foreground">Heures <b className="text-foreground">{fmtHM(h.totalMin)}</b> <span className="opacity-70">({h.weeksWithData}/{h.weeksTotal} sem.)</span></span>
            {h.suppPayEquivMin > 0 && <span className="text-emerald-700 dark:text-emerald-300">Supp payées <b>{fmtHM(h.suppPayEquivMin)}</b></span>}
            {h.suppRecupEquivMin > 0 && <span className="text-sky-700 dark:text-sky-300">Supp → récup <b>{fmtHM(h.suppRecupEquivMin)}</b></span>}
            {h.suppSansDecisionMin > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400">Supp SANS décision {fmtHM(h.suppSansDecisionMin)}</span>}
            {h.ferieMin > 0 && <span className="text-orange-700 dark:text-orange-300">Férié <b>{fmtHM(h.ferieMin)}</b></span>}
            {h.cpJours > 0 && <span className="text-violet-700 dark:text-violet-300">CP <b>{h.cpJours} j</b></span>}
            {h.recupJours > 0 && <span className="text-sky-700 dark:text-sky-300">Récup prise <b>{h.recupJours} j</b></span>}
            {h.maladieJours > 0 && <span className="text-amber-700 dark:text-amber-300">Maladie <b>{h.maladieJours} j</b></span>}
            {h.absentJours > 0 && <span className="text-rose-700 dark:text-rose-300">Absence <b>{h.absentJours} j</b></span>}
          </div>

          {/* PRIMES */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
              <Gift className="h-3.5 w-3.5" /> Primes
            </p>
            {show13eHint && (
              <button type="button"
                onClick={() => { setPrimes((cur) => [...cur, { id: newId(), motif: "13e mois (½)", montant: 0, bulletinDe: month, note: p13 != null && p13 < 1 ? `Prorata CDI ${Math.round(p13 * 100)} %` : undefined, auto: true }]); setDirty(true); }}
                className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-500/20">
                <Plus className="h-3.5 w-3.5" /> 13e mois (½ {month.slice(5) === "06" ? "juin" : "décembre"})
                {p13 != null && p13 < 1 && <span className="font-normal opacity-80">— prorata {Math.round(p13 * 100)} %</span>}
              </button>
            )}
            <div className="space-y-1.5">
              {primes.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-1.5">
                  <input value={p.motif} disabled={!canEdit} maxLength={80} placeholder="Motif"
                    onChange={(e) => patchPrime(p.id, { motif: e.target.value })}
                    className={`${inputCls} flex-1 min-w-[130px]`} aria-label="Motif de la prime" />
                  <input type="number" min={0} step={0.01} value={p.montant || ""} disabled={!canEdit} placeholder="€"
                    onChange={(e) => patchPrime(p.id, { montant: Number(e.target.value) || 0 })}
                    className={`${inputCls} w-[92px] tnum text-right`} aria-label="Montant de la prime (€)" />
                  <input type="month" value={p.bulletinDe} disabled={!canEdit} title="Sur bulletin de"
                    onChange={(e) => patchPrime(p.id, { bulletinDe: e.target.value || month })}
                    className={`${inputCls} tnum hidden sm:block`} aria-label="Sur bulletin de" />
                  <input value={p.note ?? ""} disabled={!canEdit} maxLength={200} placeholder="Note"
                    onChange={(e) => patchPrime(p.id, { note: e.target.value })}
                    className={`${inputCls} hidden md:block w-[150px]`} aria-label="Note de la prime" />
                  {canEdit && (
                    <button type="button" onClick={() => { setPrimes((cur) => cur.filter((x) => x.id !== p.id)); setDirty(true); }}
                      aria-label="Supprimer la prime"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-rose-600 hover:bg-secondary/60">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {primes.length === 0 && !show13eHint && <p className="text-[12px] italic text-muted-foreground">Aucune prime ce mois-ci.</p>}
            </div>
            {canEdit && (
              <button type="button"
                onClick={() => { setPrimes((cur) => [...cur, { id: newId(), motif: "", montant: 0, bulletinDe: month }]); setDirty(true); }}
                className="mt-1.5 inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                <Plus className="h-3.5 w-3.5" /> Ajouter une prime
              </button>
            )}
          </div>

          {/* FRAIS à rembourser */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
              <ReceiptText className="h-3.5 w-3.5" /> Remboursements de frais
            </p>
            <div className="space-y-1.5">
              {frais.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-1.5">
                  <input value={f.motif} disabled={!canEdit} maxLength={80} placeholder="Motif"
                    onChange={(e) => patchFrais(f.id, { motif: e.target.value })}
                    className={`${inputCls} flex-1 min-w-[130px]`} aria-label="Motif des frais" />
                  <input type="number" min={0} step={0.01} value={f.montant || ""} disabled={!canEdit} placeholder="€"
                    onChange={(e) => patchFrais(f.id, { montant: Number(e.target.value) || 0 })}
                    className={`${inputCls} w-[92px] tnum text-right`} aria-label="Montant des frais (€)" />
                  {canEdit && (
                    <button type="button" onClick={() => { setFrais((cur) => cur.filter((x) => x.id !== f.id)); setDirty(true); }}
                      aria-label="Supprimer les frais"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-rose-600 hover:bg-secondary/60">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {frais.length === 0 && <p className="text-[12px] italic text-muted-foreground">Aucun frais ce mois-ci.</p>}
            </div>
            {canEdit && (
              <button type="button"
                onClick={() => { setFrais((cur) => [...cur, { id: newId(), motif: "", montant: 0 }]); setDirty(true); }}
                className="mt-1.5 inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                <Plus className="h-3.5 w-3.5" /> Ajouter des frais
              </button>
            )}
          </div>

          {/* Note + enregistrement */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input value={note} disabled={!canEdit} maxLength={500} placeholder="Note pour le comptable (facultatif)"
              onChange={(e) => { setNote(e.target.value); setDirty(true); }}
              className={`${inputCls} flex-1 min-w-0`} aria-label="Note pour le comptable" />
            {canEdit && (
              <button type="button" onClick={save} disabled={saving || !dirty}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
              </button>
            )}
          </div>

          {/* FICHE PAIE derrière son propre pli (rarement modifiée). */}
          <FichePaie row={row} canEdit={canEdit} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}

/* ───────────────── Fiche paie : CDI, 13e mois, véhicule (AN) ──────────────── */

const EMPTY_VEHICULE: VehiculeAN = {
  type: "", energie: "diesel", immatriculation: "", valeurAchat: 0,
  plusDe5Ans: false, carburantRembourse: false, usage: "",
};

function FichePaie({ row, canEdit, onSaved }: { row: Row; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [cdiDate, setCdiDate] = useState(row.profile?.cdiDate ?? "");
  const [treizieme, setTreizieme] = useState(!!row.profile?.treizieme);
  const [hasVehicule, setHasVehicule] = useState(!!row.profile?.vehicule);
  const [veh, setVeh] = useState<VehiculeAN>(row.profile?.vehicule ?? { ...EMPTY_VEHICULE });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const patchVeh = (patch: Partial<VehiculeAN>) => { setVeh((cur) => ({ ...cur, ...patch })); setDirty(true); };
  const anMensuel = avantageNatureMensuel(hasVehicule ? veh : null);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/salaires", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: row.email,
          profile: { cdiDate: cdiDate || null, treizieme, vehicule: hasVehicule ? veh : null } satisfies SalaryProfile,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'enregistrement de la fiche"); return; }
      setDirty(false);
      toast.success(`Fiche paie enregistrée — ${row.name}`);
      await onSaved();
    } catch { toast.error("Échec de l'enregistrement de la fiche"); }
    finally { setSaving(false); }
  };

  const inputCls = "h-10 rounded-md border border-border bg-background px-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60";

  return (
    <div className="rounded-lg border border-border bg-secondary/20 overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/40 transition-colors">
        <Car className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Fiche paie — CDI · 13e mois · véhicule</span>
        <span className="ml-auto flex items-center gap-2 text-[11.5px] tnum text-muted-foreground">
          {row.profile?.treizieme && <span className="hidden sm:inline">13e ✓</span>}
          {anMensuel > 0 && <span className="text-orange-700 dark:text-orange-300 font-semibold">AN {eur(anMensuel)}</span>}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3 space-y-2.5">
          <div className="flex flex-wrap items-end gap-2.5">
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Entrée en CDI</label>
              <input type="date" value={cdiDate} disabled={!canEdit}
                onChange={(e) => { setCdiDate(e.target.value); setDirty(true); }}
                className={`${inputCls} tnum`} />
            </div>
            <label className="inline-flex items-center gap-1.5 h-10 text-[12.5px] font-semibold text-foreground">
              <input type="checkbox" checked={treizieme} disabled={!canEdit}
                onChange={(e) => { setTreizieme(e.target.checked); setDirty(true); }}
                className="h-4 w-4 accent-emerald-600" />
              13e mois
            </label>
            <label className="inline-flex items-center gap-1.5 h-10 text-[12.5px] font-semibold text-foreground">
              <input type="checkbox" checked={hasVehicule} disabled={!canEdit}
                onChange={(e) => { setHasVehicule(e.target.checked); setDirty(true); }}
                className="h-4 w-4 accent-emerald-600" />
              Véhicule
            </label>
          </div>

          {hasVehicule && (
            <div className="flex flex-wrap items-end gap-2.5">
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Type</label>
                <input value={veh.type} disabled={!canEdit} maxLength={60} placeholder="ex. Clio V"
                  onChange={(e) => patchVeh({ type: e.target.value })} className={`${inputCls} w-[120px]`} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Énergie</label>
                <select value={veh.energie} disabled={!canEdit}
                  onChange={(e) => patchVeh({ energie: e.target.value as VehiculeEnergie })} className={inputCls}>
                  {VEHICULE_ENERGIES.map((x) => <option key={x} value={x}>{VEHICULE_ENERGIE_LABEL[x]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Immat.</label>
                <input value={veh.immatriculation} disabled={!canEdit} maxLength={20} placeholder="AA-123-BB"
                  onChange={(e) => patchVeh({ immatriculation: e.target.value.toUpperCase() })} className={`${inputCls} w-[116px] uppercase tnum`} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Valeur (€ TTC)</label>
                <input type="number" min={0} step={100} value={veh.valeurAchat || ""} disabled={!canEdit} placeholder="21500"
                  onChange={(e) => patchVeh({ valeurAchat: Number(e.target.value) || 0 })} className={`${inputCls} w-[104px] tnum text-right`} />
              </div>
              <label className="inline-flex items-center gap-1.5 h-10 text-[12px] text-foreground">
                <input type="checkbox" checked={veh.plusDe5Ans} disabled={!canEdit}
                  onChange={(e) => patchVeh({ plusDe5Ans: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                + de 5 ans
              </label>
              <label className="inline-flex items-center gap-1.5 h-10 text-[12px] text-foreground">
                <input type="checkbox" checked={veh.carburantRembourse} disabled={!canEdit}
                  onChange={(e) => patchVeh({ carburantRembourse: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                carburant pris en charge
              </label>
              <div className="min-w-0 flex-1">
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Usage</label>
                <input value={veh.usage} disabled={!canEdit} maxLength={80} placeholder="ex. permanent pro + perso"
                  onChange={(e) => patchVeh({ usage: e.target.value })} className={`${inputCls} w-full min-w-[140px]`} />
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500/15 px-2.5 py-1.5 text-orange-700 dark:text-orange-300">
                <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold opacity-80">AN mensuel</span>
                <span className="text-[14px] font-bold tnum">{eur(anMensuel)}</span>
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-muted-foreground">
              AN véhicule au barème forfaitaire achat (15 %/10 % si + de 5 ans ; 20 %/15 % carburant
              compris ; électrique −70 % plafonné). 13e mois proratisé à la date d&apos;entrée CDI.
            </p>
            {canEdit && dirty && (
              <button type="button" onClick={save} disabled={saving}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer la fiche
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
