"use client";

import { useEffect, useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { SapGroupBadge } from "@/components/clients/SapGroupBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type { Client } from "./shared";

/* ─────────────────────────────────────────────────────────────
   NotesCluster — une surface calme, sans en-têtes uppercase :
     1. Email (chip mailto, éditable, bidir SAP)
     2. Groupe SAP (badge lecture seule)
     3. Dernière note d'appel (une seule, écrasée à chaque appel)
     4. Note libre (textarea résiduel)
───────────────────────────────────────────────────────────── */
export function NotesCluster({
  client, notesDraft, setNotesDraft, saveNotes, savingNotes, saveEmail, notesDirty,
}: {
  client: Client;
  notesDraft: string;
  setNotesDraft: (v: string) => void;
  saveNotes: () => void;
  savingNotes: boolean;
  saveEmail: (next: string) => void;
  notesDirty: boolean;
}) {
  const [emailDraft, setEmailDraft] = useState(client.email ?? "");
  const [editingEmail, setEditingEmail] = useState(false);

  // Reset email draft when active client changes
  useEffect(() => {
    setEmailDraft(client.email ?? "");
    setEditingEmail(false);
  }, [client.id, client.email]);

  // Dernière note d'appel (tous types) — les appels sont triés du + récent
  // au + ancien, donc le premier avec une note est le dernier saisi.
  const lastNote = client.appels.find((a) => a.note && a.note.trim());

  return (
    <div className="space-y-3">
      {/* ── Email + Groupe SAP : une rangée d'infos calmes ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {editingEmail ? (
          <div className="flex items-center gap-2">
            <Input
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder="client@exemple.fr"
              className="h-8 text-body"
              autoFocus
            />
            <Button
              size="sm"
              onClick={() => { saveEmail(emailDraft); setEditingEmail(false); }}
              className="h-8 px-2.5"
            >
              OK
            </Button>
            <button
              type="button"
              onClick={() => { setEmailDraft(client.email ?? ""); setEditingEmail(false); }}
              className="text-caption text-muted-foreground hover:text-foreground"
            >
              Annuler
            </button>
          </div>
        ) : client.email ? (
          <div className="flex items-center gap-2 min-w-0">
            <a
              href={`mailto:${client.email}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-body text-foreground transition-colors truncate"
              title={client.email}
            >
              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{client.email}</span>
            </a>
            <button
              type="button"
              onClick={() => setEditingEmail(true)}
              className="text-caption text-muted-foreground hover:text-foreground shrink-0"
            >
              modifier
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingEmail(true)}
            className="inline-flex items-center gap-1.5 text-body text-muted-foreground hover:text-foreground"
          >
            <Mail className="h-3.5 w-3.5" /> Ajouter un email
          </button>
        )}

        <SapGroupBadge
          clientId={client.id}
          initialCode={client.sapGroupCode}
          initialName={client.sapGroupName}
        />
      </div>

      {/* ── Dernière note d'appel (une seule, écrasée à chaque appel) ── */}
      {lastNote && (
        <div className="rounded-lg border border-border bg-secondary/25 px-2.5 py-2">
          <p className="text-caption2 tnum text-muted-foreground/80 mb-0.5">
            Dernière note · {formatDate(lastNote.heureAppel)}
          </p>
          <p className="text-body leading-snug text-foreground/90 whitespace-pre-wrap break-words">
            {lastNote.note}
          </p>
        </div>
      )}

      {/* ── Note libre (résiduelle) — le placeholder tient lieu de libellé ── */}
      <div className="space-y-1.5">
        <Textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          placeholder="Note libre : anecdotes, contexte, infos non catégorisables…"
          rows={3}
          className="resize-none text-body leading-relaxed"
        />
        {notesDirty && (
          <div className="flex items-center gap-2 animate-fade-in">
            <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
              {savingNotes ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sauvegarder"}
            </Button>
            <button
              type="button"
              onClick={() => setNotesDraft(client.notes ?? "")}
              className="text-caption text-muted-foreground hover:text-foreground transition-colors"
            >
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
