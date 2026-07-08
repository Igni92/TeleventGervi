"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Clock3, Send, CheckCircle2, CalendarClock, Loader2, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * VALIDATION MENSUELLE DES HEURES — popup + bandeau in-app à l'ouverture.
 *
 * Monté dans AppLayout → présent sur tous les écrans. Au chargement il interroge
 * /api/effectif/heures/validation :
 *   • EMPLOYEUR (direction) : au 1er du mois, tant qu'il reste des salariés à qui
 *     ENVOYER les heures du mois précédent → popup « Envoyez… » (bouton Envoyer à
 *     tous) qui revient à chaque ouverture jusqu'à l'envoi. Idem si des salariés
 *     ont proposé une autre date.
 *   • SALARIÉ : quand ses heures lui ont été envoyées → popup « Validez vos
 *     heures » (Valider / Proposer une autre date) jusqu'à l'entente.
 *
 * Le push (vraie notif) est envoyé côté serveur aux transitions ; ici c'est la
 * notif IN-APP (popup + bandeau). « Plus tard » masque pour la session en cours.
 */

interface TeamRow { email: string; name: string; status: string | null; proposal: string[]; note: string; mustAct: string | null }
interface Mine { status: string; proposal: string[]; note: string }
interface ValidData {
  ok: boolean; month: string; monthLabel: string; isManager: boolean;
  mine: Mine | null; mustValidate: boolean;
  team?: TeamRow[]; toSend?: number; counters?: number; reminderDue?: boolean;
}

export function HoursValidationGate() {
  const [data, setData] = useState<ValidData | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [propDate, setPropDate] = useState("");
  const [propNote, setPropNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/effectif/heures/validation", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ValidData | null;
      if (!j?.ok) return;
      setData(j);
      // Y a-t-il quelque chose qui requiert l'attention de CET utilisateur ?
      const managerDue = j.isManager && ((j.toSend ?? 0) > 0 || (j.counters ?? 0) > 0);
      const employeeDue = j.mustValidate;
      const dismissed = sessionStorage.getItem(`rhvalid-dismiss-${j.month}`) === "1";
      if ((managerDue || employeeDue) && !dismissed) setOpen(true);
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismiss = () => {
    if (data) sessionStorage.setItem(`rhvalid-dismiss-${data.month}`, "1");
    setOpen(false);
  };

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await fetch("/api/effectif/heures/validation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: data?.month, ...payload }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Action impossible"); return false; }
      return true;
    } catch {
      toast.error("Action impossible — réseau ?");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendAll = async () => {
    const ok = await post({ action: "send" });
    if (ok) { toast.success("Heures envoyées aux salariés pour validation."); setOpen(false); await load(); }
  };
  const accept = async (email: string) => {
    const ok = await post({ action: "accept", user: email });
    if (ok) { toast.success("Proposition acceptée — c'est validé."); await load(); }
  };
  const resend = async (email: string) => {
    const ok = await post({ action: "resend", user: email });
    if (ok) { toast.success("Renvoyé au salarié."); await load(); }
  };
  const validate = async () => {
    const ok = await post({ action: "validate" });
    if (ok) { toast.success("Heures validées — merci !"); setOpen(false); await load(); }
  };
  const sendCounter = async () => {
    const ok = await post({ action: "counter", recupDates: propDate ? [propDate] : [], note: propNote });
    if (ok) {
      toast.success("Proposition envoyée à l'employeur.");
      setProposing(false); setPropDate(""); setPropNote(""); setOpen(false); await load();
    }
  };

  if (!data) return null;

  const isManager = data.isManager;
  const managerDue = isManager && ((data.toSend ?? 0) > 0 || (data.counters ?? 0) > 0);
  const employeeDue = data.mustValidate;
  if (!managerDue && !employeeDue) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); else setOpen(true); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            {isManager ? "Heures du mois à envoyer" : "Validez vos heures"}
          </DialogTitle>
          <DialogDescription>
            {isManager
              ? <>Heures de <b className="text-foreground">{data.monthLabel}</b> à transmettre aux salariés pour validation.</>
              : <>Vos heures de <b className="text-foreground">{data.monthLabel}</b> vous ont été transmises — validez-les ou proposez une autre date.</>}
          </DialogDescription>
        </DialogHeader>

        {isManager ? (
          <div className="space-y-3">
            {(data.toSend ?? 0) > 0 && (
              <p className="text-[13px] text-muted-foreground">
                <b className="text-foreground tnum">{data.toSend}</b> salarié(s) n&apos;ont pas encore reçu leurs heures.
              </p>
            )}
            {/* Propositions à trancher (une autre date) — accepter ou renvoyer. */}
            {(data.team ?? []).filter((t) => t.status === "counter").map((t) => (
              <div key={t.email} className="rounded-lg border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 p-2.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-800 dark:text-amber-200">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" /> {t.name} propose une autre date
                </div>
                {(t.proposal.length > 0 || t.note) && (
                  <p className="mt-1 text-[12px] text-foreground">
                    {t.proposal.length > 0 && <span className="tnum font-semibold">{t.proposal.join(", ")}</span>}
                    {t.note && <span className="text-muted-foreground"> — « {t.note} »</span>}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => accept(t.email)} disabled={busy} className="gap-1 h-8 bg-emerald-600 hover:bg-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Accepter
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => resend(t.email)} disabled={busy} className="gap-1 h-8">
                    <Send className="h-3.5 w-3.5" /> Renvoyer
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              {(data.toSend ?? 0) > 0 && (
                <Button onClick={sendAll} disabled={busy} className="gap-1.5 flex-1">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Envoyer à tous
                </Button>
              )}
              <Button asChild variant="outline" className="gap-1.5 flex-1" onClick={dismiss}>
                <Link href="/heures">Ouvrir l&apos;écran Heures</Link>
              </Button>
            </div>
            <button type="button" onClick={dismiss} className="w-full text-[12px] text-muted-foreground hover:text-foreground">Plus tard</button>
          </div>
        ) : proposing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Autre date proposée (récup)</label>
              <input type="date" value={propDate} onChange={(e) => setPropDate(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Message (facultatif)</label>
              <textarea value={propNote} onChange={(e) => setPropNote(e.target.value)} rows={2} maxLength={500}
                placeholder="Ex. je préfère récupérer le vendredi 8…"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div className="flex gap-2">
              <Button onClick={sendCounter} disabled={busy || (!propDate && !propNote.trim())} className="gap-1.5 flex-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer la proposition
              </Button>
              <Button variant="outline" onClick={() => setProposing(false)} disabled={busy}>Retour</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={validate} disabled={busy} className="gap-1.5 flex-1 bg-emerald-600 hover:bg-emerald-700">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Valider mes heures
              </Button>
              <Button variant="outline" onClick={() => setProposing(true)} disabled={busy} className="gap-1.5 flex-1">
                <CalendarClock className="h-4 w-4" /> Proposer une autre date
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button asChild variant="ghost" size="sm" className="text-[12px]" onClick={dismiss}>
                <Link href="/heures">Voir le détail</Link>
              </Button>
              <button type="button" onClick={dismiss} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" /> Plus tard
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
