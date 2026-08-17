"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Send, Loader2, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/**
 * DocumentActions — bloc réutilisable posé PARTOUT où l'on accède à un document
 * (BL, avoir, facture). Cherche le PDF archivé correspondant (type + n°) et,
 * s'il existe, propose de le VISUALISER et de l'ENVOYER au client via une
 * fenêtre avec un message pré-rempli (modèle éditable).
 *
 * Si aucun PDF n'est encore archivé pour ce document, affiche un état discret
 * « non archivé » (rien à envoyer).
 */

interface FoundDoc {
  id: string;
  fileName: string;
  lastSentAt: string | null;
}
interface Prep {
  to: string;
  intendedTo: string | null;
  testMode: boolean;
  subject: string;
  body: string;
  clientNom: string | null;
}

export function DocumentActions({
  docType, docNum, docEntry, preloaded, hideWhenMissing, compact, className,
}: {
  docType: "BL" | "FACTURE" | "AVOIR" | string;
  docNum: string | number | null | undefined;
  /** DocEntry SAP — jointure stable (préféré au n° imprimé qui peut différer). */
  docEntry?: number | null;
  /** Doc déjà connu (évite le lookup) — pour les listes qui ont déjà la donnée. */
  preloaded?: FoundDoc | null;
  /** true = ne rien afficher si aucun PDF archivé (au lieu de « non archivé »). */
  hideWhenMissing?: boolean;
  /** true = boutons icône seule (compact, pour les lignes serrées). */
  compact?: boolean;
  className?: string;
}) {
  const [doc, setDoc] = useState<FoundDoc | null | "none">(preloaded ?? null); // null = chargement
  const [emailOpen, setEmailOpen] = useState(false);
  const [prep, setPrep] = useState<Prep | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);

  const numStr = docNum != null ? String(docNum) : "";

  useEffect(() => {
    if (preloaded !== undefined) { setDoc(preloaded ?? "none"); return; }
    if (!numStr && docEntry == null) { setDoc("none"); return; }
    let cancelled = false;
    setDoc(null);
    const q = new URLSearchParams({ docType });
    if (numStr) q.set("docNum", numStr);
    if (docEntry != null) q.set("docEntry", String(docEntry));
    fetch(`/api/archive/lookup?${q.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setDoc(j?.doc ?? "none"); })
      .catch(() => { if (!cancelled) setDoc("none"); });
    return () => { cancelled = true; };
  }, [preloaded, docType, numStr, docEntry]);

  const openEmail = useCallback(async () => {
    if (doc === null || doc === "none") return;
    setEmailOpen(true);
    setPrepLoading(true);
    setPrep(null);
    try {
      const r = await fetch(`/api/archive/${doc.id}/email`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Préparation impossible");
      setPrep(j);
      setSubject(j.subject ?? "");
      setBody(j.body ?? "");
      setTo(j.testMode ? j.to : (j.intendedTo ?? j.to ?? ""));
    } catch (e) {
      toast.error((e as Error).message);
      setEmailOpen(false);
    } finally {
      setPrepLoading(false);
    }
  }, [doc]);

  const send = useCallback(async () => {
    if (doc === null || doc === "none") return;
    setSending(true);
    try {
      const r = await fetch(`/api/archive/${doc.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, to: prep?.testMode ? undefined : to }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec de l'envoi");
      toast.success(j.testMode ? `Envoyé (mode test) à ${j.to}` : `Envoyé à ${j.to}`);
      setDoc({ ...doc, lastSentAt: new Date().toISOString() });
      setEmailOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }, [doc, subject, body, to, prep]);

  // Chargement du lookup.
  if (doc === null) {
    return <span className={`inline-flex items-center text-muted-foreground/50 ${className ?? ""}`}><Loader2 className="h-3.5 w-3.5 animate-spin" /></span>;
  }
  // Pas de PDF archivé.
  if (doc === "none") {
    if (hideWhenMissing) return null;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground/40 ${className ?? ""}`} title="Aucun PDF archivé pour ce document">
        <FileText className="h-3.5 w-3.5" /> non archivé
      </span>
    );
  }

  const btn = `inline-flex items-center gap-1 h-7 rounded-lg border border-border bg-card text-[11.5px] font-medium text-foreground hover:bg-secondary/60 transition-colors ${compact ? "px-1.5" : "px-2"}`;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => window.open(`/api/archive/${doc.id}/pdf`, "_blank", "noopener")}
        className={btn}
        title="Visualiser le PDF"
      >
        <FileText className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
        {!compact && <>PDF <ExternalLink className="h-3 w-3 text-muted-foreground/50" /></>}
      </button>
      <button
        type="button"
        onClick={openEmail}
        className={btn}
        title={doc.lastSentAt ? `Déjà envoyé le ${new Date(doc.lastSentAt).toLocaleString("fr-FR")}` : "Envoyer au client"}
      >
        <Send className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
        {!compact && "Envoyer"}
        {doc.lastSentAt && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
      </button>

      <Dialog open={emailOpen} onOpenChange={(o) => { if (!o) setEmailOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              Envoyer le document au client
            </DialogTitle>
            <DialogDescription className="sr-only">Fenêtre d&apos;envoi du document par e-mail.</DialogDescription>
          </DialogHeader>

          {prepLoading || !prep ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Préparation…</div>
          ) : (
            <div className="space-y-3">
              {prep.testMode && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/25 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>Mode <b>test</b> : le message part vers la boîte de test ({prep.to}){prep.intendedTo ? <> — destinataire réel visé : {prep.intendedTo}</> : null}. Activez l&apos;envoi réel dans Paramètres → Intégrations.</span>
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Destinataire</span>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={prep.testMode}
                  className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[13px] disabled:opacity-60"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Objet</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[13px]" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Message</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] leading-relaxed resize-y" />
              </label>
              <p className="text-[11px] text-muted-foreground">Pièce jointe : <span className="font-medium text-foreground/80">{doc.fileName}</span></p>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEmailOpen(false)} className="h-9 px-3 rounded-lg text-[13px] text-muted-foreground hover:text-foreground">Annuler</button>
                <button
                  type="button"
                  onClick={send}
                  disabled={sending || !subject.trim() || !body.trim()}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-60"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}
