"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, X, Send, Mail, AlertTriangle, ShieldCheck, History } from "lucide-react";
import { RELANCE_LEVELS, suggestLevel, type RelanceCode } from "@/lib/relance/levels";

interface PreviewRecipient {
  to: string;
  intendedTo: string | null;
  testMode: boolean;
}
interface PreviewTotals {
  nbFactures: number;
  principal: number;
  penalites: number;
  ifr: number;
  total: number;
}
interface PreviewData {
  subject: string;
  html: string;
  channel: string;
  from: string;
  recommande: boolean;
  recipient: PreviewRecipient;
  clientEmailCompta: string | null;
  totals: PreviewTotals;
}
interface RelanceLogRow {
  id: string;
  level: string;
  channel: string;
  recipient: string;
  testMode: boolean;
  status: string;
  montantTotal: number;
  sentAt: string;
}

const eur = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RelanceDialog({
  cardCode,
  cardName,
  maxOverdueDays,
  onClose,
  onSent,
}: {
  cardCode: string;
  cardName: string;
  maxOverdueDays: number;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [level, setLevel] = useState<RelanceCode>(suggestLevel(maxOverdueDays) ?? "R0");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentLevel, setSentLevel] = useState<RelanceCode | null>(null);
  const [logs, setLogs] = useState<RelanceLogRow[]>([]);
  // Anti-course : on ignore la réponse d'un aperçu si un autre a été demandé depuis.
  const reqRef = useRef(0);

  const meta = useMemo(() => RELANCE_LEVELS.find((l) => l.code === level)!, [level]);
  const suggested = useMemo(() => suggestLevel(maxOverdueDays), [maxOverdueDays]);

  const loadPreview = useCallback(async () => {
    const myReq = ++reqRef.current;
    setLoading(true);
    setPreview(null);
    try {
      const r = await fetch("/api/relance/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardCode, level }),
      });
      const j = await r.json();
      if (myReq !== reqRef.current) return; // réponse obsolète (niveau changé entre-temps)
      if (!r.ok || !j.ok) { toast.error(j.error || "Aperçu impossible"); return; }
      setPreview(j);
    } catch (e) {
      if (myReq === reqRef.current) toast.error((e as Error).message);
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, [cardCode, level]);

  const loadLogs = useCallback(async () => {
    try {
      const r = await fetch(`/api/relance/log?cardCode=${encodeURIComponent(cardCode)}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.ok) setLogs(j.logs);
    } catch { /* historique non bloquant */ }
  }, [cardCode]);

  useEffect(() => { loadPreview(); }, [loadPreview]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const send = useCallback(async () => {
    setSending(true);
    try {
      const r = await fetch("/api/relance/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardCode, level }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Envoi impossible"); return; }
      setSentLevel(level); // verrouille le bouton pour ce niveau (anti-doublon UI)
      toast.success(
        j.recipient?.testMode
          ? `Relance ${level} envoyée (test) → ${j.recipient.to}`
          : `Relance ${level} envoyée → ${j.recipient?.to}`,
      );
      loadLogs();
      onSent?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }, [cardCode, level, loadLogs, onSent]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="kicker mb-0.5">Relance / recouvrement · NT-2026-RC-01</p>
            <h2 className="text-[18px] font-semibold tracking-tight text-foreground truncate">{cardName}</h2>
            <p className="text-[11.5px] font-mono text-muted-foreground">{cardCode}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground"><X className="h-4 w-4" /></button>
        </header>

        {/* Sélecteur de niveau R0→R5 */}
        <div className="shrink-0 px-5 pt-3">
          <div className="grid grid-cols-6 gap-1.5">
            {RELANCE_LEVELS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLevel(l.code)}
                aria-pressed={level === l.code}
                title={`${l.libelle} · ${l.declenchement} · ${l.canal}`}
                className={`h-9 rounded-md border text-[12.5px] font-bold transition-colors ${
                  level === l.code
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {l.code}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted-foreground mt-1.5">
            <b className="text-foreground">{meta.libelle}</b> · {meta.declenchement} · {meta.canal} · <i>{meta.tonalite}</i>
            {suggested === meta.code && <span className="ml-1 text-brand-600 dark:text-brand-400">(suggéré)</span>}
          </p>
        </div>

        {/* Bandeau destinataire / mode test */}
        <div className="shrink-0 px-5 pt-3">
          {preview && (
            preview.recipient.testMode ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/25 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[12px] text-amber-800 dark:text-amber-200">
                  <b>Mode test</b> — depuis <b className="font-mono">{preview.from}</b>, l&apos;email partira vers <b className="font-mono">{preview.recipient.to}</b>
                  {preview.recipient.intendedTo
                    ? <> et non vers le client (<span className="font-mono">{preview.recipient.intendedTo}</span>).</>
                    : <> (aucun email compta connu pour ce client).</>}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/25 px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-[12px] text-emerald-800 dark:text-emerald-200">
                  <b>Envoi réel</b> — depuis <b className="font-mono">{preview.from}</b> vers <b className="font-mono">{preview.recipient.to}</b>.
                </p>
              </div>
            )
          )}
        </div>

        {/* Aperçu du courrier */}
        <div className="flex-1 overflow-auto px-5 py-3 space-y-3">
          {loading ? (
            <div className="h-48 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : preview ? (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-[12.5px] font-semibold text-foreground truncate">{preview.subject}</span>
                </div>
                <iframe
                  title="Aperçu de la relance"
                  srcDoc={preview.html}
                  sandbox=""
                  className="w-full h-[300px] bg-white"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                <Stat label={`Principal (${preview.totals.nbFactures} fact.)`} value={eur(preview.totals.principal)} />
                <Stat label="Pénalités" value={eur(preview.totals.penalites)} hint={preview.totals.penalites === 0 ? "taux CGV non paramétré" : undefined} />
                <Stat label="Indemnité forfait." value={eur(preview.totals.ifr)} />
                <Stat label="Total dû" value={eur(preview.totals.total)} strong />
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-[13px] text-muted-foreground">Aucun aperçu.</div>
          )}

          {logs.length > 0 && (
            <div className="rounded-lg border border-border">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Historique des relances ({logs.length})
              </div>
              <ul className="divide-y divide-border/50">
                {logs.map((log) => (
                  <li key={log.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
                    <span className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{log.level}</span>
                      <span className="text-muted-foreground">{new Date(log.sentAt).toLocaleString("fr-FR")}</span>
                      {log.testMode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-semibold">TEST</span>}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-muted-foreground truncate max-w-[160px]">{log.recipient}</span>
                      <span className={log.status === "ENVOYE" ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-rose-600 dark:text-rose-400 font-semibold"}>{log.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Pied : envoi */}
        <footer className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
          <p className="text-[11px] text-muted-foreground max-w-md">
            L&apos;email part depuis la boîte partagée{preview?.from ? <> <b className="font-mono">{preview.from}</b></> : ""}. {meta.canal.includes("LRAR") && <b className="text-amber-600 dark:text-amber-400">Niveau LRAR : l&apos;email de test ne remplace pas le recommandé postal. </b>}
            Chaque envoi est journalisé (piste d&apos;audit).
          </p>
          <button
            type="button"
            onClick={send}
            disabled={sending || loading || !preview || sentLevel === level}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sentLevel === level ? "Envoyé ✓" : preview?.recipient.testMode ? "Envoyer (test)" : "Envoyer"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={`tnum mt-0.5 ${strong ? "text-[15px] font-bold text-foreground" : "text-[13.5px] font-semibold text-foreground"}`}>{value}</div>
      {hint && <div className="text-[9.5px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
