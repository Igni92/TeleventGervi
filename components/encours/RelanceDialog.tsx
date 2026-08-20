"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, X, Send, Mail, AlertTriangle, ShieldCheck, History, ArrowLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatBlock } from "@/components/ui/stat-block";
import { InfoHint } from "@/components/ui/info-hint";
import { RELANCE_LEVELS, suggestLevel, type RelanceCode } from "@/lib/relance/levels";

interface PreviewRecipient {
  to: string;
  intendedTo: string | null;
  testMode: boolean;
}
interface PreviewTotals {
  nbFactures: number;
  openTotal: number;
  encaissementsNonAffectes: number;
  principal: number;
  penalites: number;
  ifr: number;
  /** Nombre de factures encore dues (net > 0). */
  nbFacturesDues: number;
  /** Nombre de factures touchées par l'indemnité forfaitaire (retard ≥ 31 j). */
  nbFacturesIFR: number;
  /** Montant forfaitaire unitaire (€) appliqué par facture due. */
  ifrParFacture: number;
  /** Nombre de factures de SERVICE (à personnaliser à la main). */
  nbServiceInvoices: number;
  /** true = relance 100 % service → envoi auto bloqué (courrier manuel). */
  serviceOnly: boolean;
  total: number;
}
interface PreviewData {
  subject: string;
  html: string;
  channel: string;
  from: string;
  attachInvoices: boolean;
  recommande: boolean;
  recipient: PreviewRecipient;
  clientEmailCompta: string | null;
  /** Relances activées pour ce client ? false → envoi bloqué (case décochée). */
  relanceActive?: boolean;
  /** Taux appliqué (case « Taux » du récap). */
  rate?: { legalPct: string; appliedPct: string; multiplier: number; label: string };
  /** Avoirs du client — imputés (déduits) et en faveur (non imputés). */
  avoirs?: {
    imputesTotal: number;
    enFaveurTotal: number;
    enFaveur: { num: string; date: string; montant: number }[];
  };
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
  onBack,
  onSent,
}: {
  cardCode: string;
  cardName: string;
  maxOverdueDays: number;
  onClose: () => void;
  /** Feuille 2 étapes : retour au détail du client (si ouvert depuis le détail). */
  onBack?: () => void;
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
      if (j.warning) {
        toast.warning(j.warning, { duration: Infinity });
      } else {
        toast.success(
          j.recipient?.testMode
            ? `Relance ${level} envoyée (test) → ${j.recipient.to}`
            : `Relance ${level} envoyée → ${j.recipient?.to}`,
        );
      }
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-modal w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="min-w-0 flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} title="Retour au détail du client"
                className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0">
              <p className="kicker mb-0.5">Relance / recouvrement · NT-2026-RC-01</p>
              <h2 className="text-title3 font-semibold tracking-tight text-foreground truncate">{cardName}</h2>
              <p className="text-caption font-mono text-muted-foreground">{cardCode}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground"><X className="h-4 w-4" /></button>
        </header>

        {/* Sélecteur de niveau — liste radio libellée (chaque palier explicite). */}
        <div className="shrink-0 px-5 pt-3">
          <div role="radiogroup" aria-label="Niveau de relance" className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {RELANCE_LEVELS.map((l) => {
              const on = level === l.code;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setLevel(l.code)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                    on ? "bg-brand-500/10" : "hover:bg-secondary/60",
                  )}
                >
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1", on ? "bg-brand-500 ring-brand-500" : "ring-border")}>
                    {on && <Check className="h-3 w-3 text-brand-950" />}
                  </span>
                  <span className="w-9 shrink-0 text-body font-bold tnum text-foreground">{l.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-foreground">
                      {l.libelle}
                      {suggested === l.code && <span className="ml-1.5 text-caption font-semibold text-brand-600 dark:text-brand-400">(suggéré)</span>}
                    </span>
                    <span className="block truncate text-caption text-muted-foreground">{l.declenchement} · {l.canal} · {l.tonalite}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bandeau destinataire / mode test */}
        <div className="shrink-0 px-5 pt-3">
          {preview && (
            preview.recipient.testMode ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <p className="text-caption text-foreground">
                  <b>Mode test</b> — depuis <b className="font-mono">{preview.from}</b>, l&apos;email partira vers <b className="font-mono">{preview.recipient.to}</b>
                  {preview.recipient.intendedTo
                    ? <> et non vers le client (<span className="font-mono">{preview.recipient.intendedTo}</span>).</>
                    : <> (aucun email compta connu pour ce client).</>}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-success/50 bg-success/10 px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-success mt-0.5 shrink-0" />
                <p className="text-caption text-foreground">
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
                <div className="flex items-center gap-2 px-3 py-2 bg-secondary/60 border-b border-border">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-caption font-semibold text-foreground truncate">{preview.subject}</span>
                </div>
                {/* Papier de l'email : document reçu par le client, volontairement
                    blanc dans les deux thèmes (l'email ne suit pas le thème app). */}
                <iframe
                  title="Aperçu de la relance"
                  srcDoc={preview.html}
                  sandbox=""
                  className="w-full h-[300px]"
                  style={{ background: "hsl(0 0% 100%)" }}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                <Stat label={`Principal net (${preview.totals.nbFactures} fact.)`} value={eur(preview.totals.principal)} />
                {preview.rate && (
                  <Stat
                    label="Taux appliqué"
                    value={preview.rate.appliedPct}
                    hint={`${preview.rate.multiplier} × taux légal ${preview.rate.legalPct}`}
                  />
                )}
                <Stat label="Pénalités" value={eur(preview.totals.penalites)} hint={preview.totals.penalites === 0 ? "taux CGV non paramétré" : undefined} />
                <Stat
                  label="Indemnité forfait."
                  value={eur(preview.totals.ifr)}
                  hint={preview.totals.nbFacturesIFR > 0
                    ? `${preview.totals.nbFacturesIFR} facture${preview.totals.nbFacturesIFR > 1 ? "s" : ""} en retard ≥ 31 j × ${eur(preview.totals.ifrParFacture)}`
                    : "aucune facture ≥ 31 j de retard"}
                />
                <Stat label="Total dû" value={eur(preview.totals.total)} strong />
              </div>
              {preview.totals.encaissementsNonAffectes > 0 && (
                <p className="text-caption text-muted-foreground">
                  Factures échues <b className="text-foreground">{eur(preview.totals.openTotal)}</b> − encaissements/avoirs reçus non affectés{" "}
                  <b className="text-emerald-600 dark:text-emerald-400">−{eur(preview.totals.encaissementsNonAffectes)}</b> = principal net{" "}
                  <b className="text-foreground">{eur(preview.totals.principal)}</b> (solde compte tiers).
                </p>
              )}
              {preview.avoirs && (preview.avoirs.imputesTotal > 0.005 || preview.avoirs.enFaveurTotal > 0.005) && (
                <div className="flex items-start gap-2 rounded-lg border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-caption text-violet-800 dark:text-violet-200">
                  <span className="font-semibold">Avoirs</span>
                  <span>
                    {preview.avoirs.imputesTotal > 0.005 && <>Imputé sur les factures : <b>{eur(preview.avoirs.imputesTotal)}</b>. </>}
                    {preview.avoirs.enFaveurTotal > 0.005 && (
                      <>En faveur du client (non imputé) : <b>{eur(preview.avoirs.enFaveurTotal)}</b>
                        {preview.avoirs.enFaveur.length > 0 && <> — n° {preview.avoirs.enFaveur.map((a) => a.num).join(", ")}</>}.
                      </>
                    )}
                  </span>
                </div>
              )}
              {meta.serviceOnly && (
                <div className="flex items-start gap-2 rounded-lg border border-violet-400/50 bg-violet-500/10 px-3 py-2 text-caption text-violet-800 dark:text-violet-200">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    <b>Relance de factures de service</b> (location / prestation / palettes / destruction) —{" "}
                    courrier <b>interne</b>, envoyé à la <b>comptabilité</b> ({preview.recipient.to}) pour retraitement et
                    personnalisation avant tout envoi au client.
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-body text-muted-foreground">Aucun aperçu.</div>
          )}

          {logs.length > 0 && (
            <div className="rounded-lg border border-border">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border kicker">
                <History className="h-3.5 w-3.5" /> Historique des relances ({logs.length})
              </div>
              <ul className="divide-y divide-border/60">
                {logs.map((log) => (
                  <li key={log.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-caption">
                    <span className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{log.level}</span>
                      <span className="text-muted-foreground">{new Date(log.sentAt).toLocaleString("fr-FR")}</span>
                      {log.testMode && <span className="text-caption2 px-1.5 py-0.5 rounded bg-warning/12 text-warning ring-1 ring-warning/25 font-semibold">TEST</span>}
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
          <p className="text-caption2 text-muted-foreground max-w-md">
            L&apos;email part depuis la boîte partagée{preview?.from ? <> <b className="font-mono">{preview.from}</b></> : ""}.{" "}
            {preview?.attachInvoices && <>Les PDF des factures sont joints. </>}
            {meta.canal.includes("LRAR") && <b className="text-amber-600 dark:text-amber-400">Niveau LRAR : l&apos;email de test ne remplace pas le recommandé postal. </b>}
            Chaque envoi est journalisé (piste d&apos;audit).
          </p>
          <Button
            onClick={send}
            disabled={sending || loading || !preview || sentLevel === level || preview?.relanceActive === false}
            title={preview?.relanceActive === false ? "Relances désactivées pour ce client" : undefined}
            className="shrink-0"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : sentLevel === level ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {sentLevel === level ? "Envoyé" : preview?.relanceActive === false ? "Relances désactivées" : meta.serviceOnly ? "Envoyer à la compta" : preview?.recipient.testMode ? "Envoyer (test)" : "Envoyer"}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Tuile stat locale — StatBlock partagé ; la précision (hint) vit derrière le « ? ». */
function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <StatBlock
        label={hint ? <span className="inline-flex items-center gap-1.5">{label}<InfoHint label={label} size={13}>{hint}</InfoHint></span> : label}
        value={value}
        size={strong ? "md" : "sm"}
      />
    </div>
  );
}
