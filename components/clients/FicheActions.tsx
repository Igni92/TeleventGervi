"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShoppingCart, PhoneCall, Loader2, Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Actions commerciales depuis la fiche client (mobile-first) : un commercial
 * passe une commande pour ce client, ou notifie un appel (avec note). Pas de
 * console / plan d'appel sur mobile — tout part d'ici.
 */
export function FicheActions({ clientId }: { clientId: string; clientName?: string }) {
  const router = useRouter();
  const [callOpen, setCallOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // « Commander » ouvre la console de commande PRÉ-CHARGÉE sur ce client ; le
  // paramètre returnTo ramène ici automatiquement une fois la commande passée.
  const openConsole = () => {
    const returnTo = encodeURIComponent(`/clients/${clientId}`);
    router.push(`/console2?client=${clientId}&returnTo=${returnTo}`);
  };

  async function logAppel(type: "COMMANDE" | "DEMAIN") {
    setSaving(true);
    try {
      const res = await fetch("/api/appels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, type, note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      toast.success(type === "COMMANDE" ? "Appel noté : commande passée" : "Appel noté : à rappeler");
      setNote("");
      setCallOpen(false);
    } catch (e) {
      toast.error(`Échec de l'enregistrement : ${e instanceof Error ? e.message : ""}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-brand-500/[0.06] p-5 shadow-card">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-brand-500/10 blur-3xl"
      />
      <div className="relative space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-brand-600 ring-1 ring-brand-500/20 dark:text-brand-400">
            <Zap className="h-[17px] w-[17px]" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[14.5px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
              Actions commerciales
            </h3>
            <p className="text-[12px] leading-snug text-muted-foreground">
              Passer une commande ou noter un appel
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Button onClick={openConsole} className="h-12 gap-2 text-[15px]">
            <ShoppingCart className="h-4 w-4" /> Commander
          </Button>
          <Button variant="outline" onClick={() => setCallOpen((o) => !o)} className="h-12 gap-2 text-[15px]">
            <PhoneCall className="h-4 w-4" /> Notifier un appel
          </Button>
        </div>

        {callOpen && (
          <div className="space-y-2.5 rounded-xl border border-border bg-background/60 p-3">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note d'appel (facultatif)…"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Button variant="outline" disabled={saving} onClick={() => logAppel("COMMANDE")} className="h-11 gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-emerald-500" />} Commande passée
              </Button>
              <Button variant="outline" disabled={saving} onClick={() => logAppel("DEMAIN")} className="h-11 gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />} À rappeler
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
