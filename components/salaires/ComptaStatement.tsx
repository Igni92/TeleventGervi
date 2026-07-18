"use client";

/**
 * ÉTAT COMPTABLE — génération + envoi du document mensuel (VRAI PDF joint) au
 * cabinet, et LISTE de tous les documents déjà transmis (rectifs compris).
 *
 * Le PDF est produit CÔTÉ NAVIGATEUR (jsPDF, cf. lib/salairesPdfDoc) : « Aperçu »
 * l'ouvre, « Envoyer » le joint au mail des destinataires configurés. Chaque
 * envoi est journalisé et ré-ouvrable / ré-envoyable (rectificatif). Réservé
 * admin/direction (le cabinet ne se connecte plus — il reçoit les mails).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Eye, Send, CalendarDays, Mail, CheckCircle2, Save, FileText } from "lucide-react";
import { monthIdOf, shiftMonth } from "@/lib/heuresCalc";
import {
  salaireMonthLabel,
  type SalaryEnvoi, type SalaryHeures, type SalaryMonthData, type SalaryProfile,
} from "@/lib/salaires";
import { buildSalairesPdf, type PdfEmploye } from "@/lib/salairesPdfDoc";

interface Row {
  email: string;
  name: string;
  heures: SalaryHeures;
  salary: SalaryMonthData | null;
  profile: SalaryProfile | null;
  anMensuel: number;
  missing: string[];
}
interface ApiData {
  ok: boolean; month: string; rows: Row[];
  sent: { sentAt: string; sentBy: string; to: string[] } | null;
  comptaEmails: string[];
  envois: SalaryEnvoi[];
}

/** Les 18 derniers mois (mois courant inclus) — la liste déroulante. */
function monthOptions(): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  let m = monthIdOf(new Date());
  for (let i = 0; i < 18; i++) {
    out.push({ id: m, label: salaireMonthLabel(m) });
    m = shiftMonth(m, -1);
  }
  return out;
}

/** Ne garde que les salariés avec des données ce mois-ci. */
const hasData = (r: Row) => r.heures.weeksWithData > 0
  || (r.salary && (r.salary.primes.length > 0 || r.salary.frais.length > 0))
  || !!r.profile?.vehicule;

const toPdfEmploye = (r: Row): PdfEmploye => ({
  name: r.name, heures: r.heures, anMensuel: r.anMensuel,
  vehicule: r.profile?.vehicule ?? null,
  primes: r.salary?.primes ?? [], frais: r.salary?.frais ?? [], note: r.salary?.note,
});

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export function ComptaStatement() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].id);
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);   // clé d'action en cours (ex. "send:2026-07")
  const [emails, setEmails] = useState("");
  const [emailsDirty, setEmailsDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/salaires?month=${month}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ApiData | null;
      if (j?.ok) {
        setData(j);
        setEmails((prev) => (emailsDirty ? prev : (j.comptaEmails ?? []).join(", ")));
      } else {
        toast.error((j as { error?: string } | null)?.error || "Chargement impossible");
      }
    } finally {
      setLoading(false);
    }
  }, [month, emailsDirty]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.rows ?? []).filter(hasData), [data]);
  const missingTotal = rows.reduce((s, r) => s + r.missing.length, 0);
  const envois = data?.envois ?? [];

  /** Récupère les salariés (avec données) d'un mois — pour l'aperçu/renvoi depuis
   *  la liste, où le mois peut différer du mois sélectionné. */
  const employesOf = async (m: string): Promise<PdfEmploye[]> => {
    if (m === month) return rows.map(toPdfEmploye);
    const r = await fetch(`/api/salaires?month=${m}`, { cache: "no-store" });
    const j = (await r.json().catch(() => null)) as ApiData | null;
    return (j?.rows ?? []).filter(hasData).map(toPdfEmploye);
  };

  const preview = async (m: string) => {
    setBusy(`preview:${m}`);
    try {
      const emp = await employesOf(m);
      if (emp.length === 0) { toast.info(`Aucune donnée pour ${salaireMonthLabel(m)}.`); return; }
      const doc = await buildSalairesPdf(m, emp);
      const url = doc.output("bloburl") as unknown as string;
      if (!window.open(url, "_blank")) toast.error("Aperçu bloqué — autorisez les pop-ups.");
    } catch {
      toast.error("Génération du PDF impossible.");
    } finally { setBusy(null); }
  };

  const send = async (m: string, kind: "normal" | "rectif") => {
    const emp = await employesOf(m).catch(() => []);
    if (emp.length === 0) { toast.error(`Aucune donnée à envoyer pour ${salaireMonthLabel(m)}.`); return; }
    if (kind === "normal" && m === month && missingTotal > 0
      && !window.confirm(`${missingTotal} élément(s) manquant(s) — envoyer quand même au cabinet ?`)) return;
    if (kind === "rectif" && !window.confirm(`Envoyer un RECTIFICATIF pour ${salaireMonthLabel(m)} au cabinet ?`)) return;
    setBusy(`send:${m}:${kind}`);
    try {
      const doc = await buildSalairesPdf(m, emp);
      // datauristring = « data:application/pdf;filename=…;base64,XXXX » → on n'envoie
      // que la partie base64 pure (la pièce jointe Graph attend `contentBytes`).
      const dataUri = doc.output("datauristring") as unknown as string;
      const pdfBase64 = dataUri.slice(dataUri.indexOf("base64,") + "base64,".length);
      const r = await fetch("/api/salaires", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", month: m, pdfBase64, kind }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'envoi"); return; }
      toast.success(`Document ${kind === "rectif" ? "rectificatif " : ""}envoyé — ${(j.recipients ?? []).join(", ")}`);
      await load();
    } catch {
      toast.error("Échec de l'envoi");
    } finally { setBusy(null); }
  };

  const saveEmails = async () => {
    setBusy("emails");
    try {
      const r = await fetch("/api/salaires", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setComptaEmails", emails }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Enregistrement impossible"); return; }
      setEmails((j.comptaEmails ?? []).join(", "));
      setEmailsDirty(false);
      toast.success(j.comptaEmails?.length ? "Destinataires enregistrés." : "Aucun email valide — repli sur compta@gervifrais.com.");
    } catch {
      toast.error("Enregistrement impossible");
    } finally { setBusy(null); }
  };

  const btn = "inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-lg text-[13px] font-semibold disabled:opacity-50";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      {/* ── Générer & envoyer le document du mois ── */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">Gervifrais · Compta / paie</p>
            <h2 className="text-[16px] font-bold text-foreground">Document mensuel — cabinet comptable</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mois"
              className="h-10 rounded-lg border border-border bg-background px-3 text-[13px] font-semibold capitalize focus:outline-none focus:ring-1 focus:ring-brand-500">
              {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="px-4 py-3.5 sm:px-6 space-y-3">
          {/* Destinataires du cabinet (à remplir) */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
              <Mail className="h-3.5 w-3.5" /> Mail(s) du cabinet comptable
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={emails}
                onChange={(e) => { setEmails(e.target.value); setEmailsDirty(true); }}
                placeholder="compta@cabinet.fr, paie@cabinet.fr"
                aria-label="Mails du cabinet comptable"
                className="h-9 flex-1 min-w-[220px] rounded-md border border-border bg-background px-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button type="button" onClick={saveEmails} disabled={busy === "emails" || !emailsDirty}
                className={`${btn} h-9 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60`}>
                {busy === "emails" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Séparés par des virgules. Le document part vers ces adresses (repli : compta@gervifrais.com).
            </p>
          </div>

          {/* Aperçu + Envoyer */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-[12.5px] text-muted-foreground">
              {loading ? "Chargement…" : `${rows.length} salarié(s) · ${salaireMonthLabel(month)}`}
              {!loading && missingTotal > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400 font-semibold">{missingTotal} élément(s) manquant(s)</span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => preview(month)} disabled={loading || rows.length === 0 || busy?.startsWith("preview")}
                className={`${btn} border border-border text-foreground hover:bg-secondary/60`}>
                {busy === `preview:${month}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Aperçu PDF
              </button>
              <button type="button" onClick={() => send(month, "normal")} disabled={loading || rows.length === 0 || busy?.startsWith("send")}
                className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
                {busy === `send:${month}:normal` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer au cabinet
              </button>
            </div>
          </div>
          {data?.sent && (
            <p className="inline-flex items-center gap-1.5 text-[11.5px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Dernier envoi le {fmtDate(data.sent.sentAt)} — {data.sent.to.join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* ── Liste des documents transmis ── */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[13.5px] font-bold text-foreground">Documents transmis</h3>
          <span className="text-[11.5px] text-muted-foreground">({envois.length})</span>
        </div>
        {envois.length === 0 ? (
          <p className="px-4 py-5 sm:px-6 text-[13px] italic text-muted-foreground">Aucun document envoyé pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {envois.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-6">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-semibold text-foreground capitalize">{salaireMonthLabel(e.monthId)}</span>
                  {e.kind === "rectif" && (
                    <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Rectif</span>
                  )}
                </span>
                <span className="text-[11.5px] text-muted-foreground truncate">
                  {fmtDate(e.sentAt)} · {e.to.join(", ")}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" onClick={() => preview(e.monthId)} disabled={busy?.startsWith("preview")}
                    title="Ré-ouvrir le PDF de ce mois"
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
                    {busy === `preview:${e.monthId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Aperçu
                  </button>
                  <button type="button" onClick={() => send(e.monthId, "rectif")} disabled={busy?.startsWith("send")}
                    title="Renvoyer un rectificatif pour ce mois"
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
                    {busy === `send:${e.monthId}:rectif` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Rectif
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
