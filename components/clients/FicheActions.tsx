"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShoppingCart, PhoneCall, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BLDialog } from "@/components/console/BLDialog";

/**
 * Actions commerciales depuis la fiche client (mobile-first) : un commercial
 * passe une commande pour ce client, ou notifie un appel (avec note). Pas de
 * console / plan d'appel sur mobile — tout part d'ici.
 */
export function FicheActions({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [blOpen, setBlOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

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
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Button onClick={() => setBlOpen(true)} className="h-12 text-[15px] gap-2">
          <ShoppingCart className="h-4 w-4" /> Commander
        </Button>
        <Button variant="outline" onClick={() => setCallOpen((o) => !o)} className="h-12 text-[15px] gap-2">
          <PhoneCall className="h-4 w-4" /> Notifier un appel
        </Button>
      </div>

      {callOpen && (
        <div className="space-y-2.5 pt-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note d'appel (facultatif)…"
            className="w-full h-11 rounded-md border border-border bg-background px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline" disabled={saving} onClick={() => logAppel("COMMANDE")} className="h-11 gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-emerald-500" />} Commande passée
            </Button>
            <Button variant="outline" disabled={saving} onClick={() => logAppel("DEMAIN")} className="h-11 gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />} À rappeler
            </Button>
          </div>
        </div>
      )}

      <BLDialog
        open={blOpen}
        onOpenChange={setBlOpen}
        clientId={clientId}
        clientName={clientName}
        onCreated={() => setBlOpen(false)}
      />
    </div>
  );
}
