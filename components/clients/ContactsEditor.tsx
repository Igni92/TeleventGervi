"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Users, Plus, Trash2, Loader2, Phone, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { TypeCombobox } from "@/components/TypeCombobox";

interface Contact {
  id: string; name: string; role: string | null;
  phone: string | null; email: string | null; note: string | null;
}

export function ContactsEditor({ clientId }: { clientId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newC, setNewC] = useState({ name: "", role: "", phone: "", email: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts`);
      const json = await res.json();
      setContacts(json.contacts ?? []);
    } catch { toast.error("Erreur chargement contacts"); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { refresh(); }, [refresh]);

  const patch = async (id: string, data: Partial<Contact>) => {
    try {
      await fetch(`/api/clients/${clientId}/contacts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      setContacts((cur) => cur.map((c) => c.id === id ? { ...c, ...data } : c));
    } catch { toast.error("Erreur sauvegarde"); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cet interlocuteur ?")) return;
    await fetch(`/api/clients/${clientId}/contacts/${id}`, { method: "DELETE" });
    setContacts((cur) => cur.filter((c) => c.id !== id));
  };

  const add = async () => {
    if (!newC.name.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newC),
      });
      const json = await res.json();
      if (json.contact) setContacts((cur) => [...cur, json.contact]);
      setNewC({ name: "", role: "", phone: "", email: "" });
    } catch { toast.error("Erreur création"); }
    finally { setAdding(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-foreground">Interlocuteurs</h3>
        <InfoTip label="Interlocuteurs" content={<>Plusieurs contacts par client (chef pâtissier, apprenti…).<br/>Le <b>type</b> se choisit dans une liste réutilisable que tu peux enrichir.</>} side="right" iconSize={11} />
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <ul className="space-y-2">
          {contacts.map((c, i) => (
            <li key={c.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="h-5 w-5 shrink-0 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 text-[10px] font-bold inline-flex items-center justify-center">{i + 1}</span>
                <Input defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && patch(c.id, { name: e.target.value.trim() })}
                  placeholder="Nom" className="h-8 text-[13px] font-medium flex-1" />
                <TypeCombobox kind="contact" value={c.role} onChange={(role) => patch(c.id, { role })} placeholder="Type / poste" className="w-44" />
                <button type="button" onClick={() => remove(c.id)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground/40 hover:text-rose-500 hover:bg-secondary/60 shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 pl-7">
                <span className="relative flex-1">
                  <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input defaultValue={c.phone ?? ""} onBlur={(e) => e.target.value !== (c.phone ?? "") && patch(c.id, { phone: e.target.value })}
                    placeholder="Téléphone" className="h-7 text-[12px] pl-7 font-mono" />
                </span>
                <span className="relative flex-1">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input defaultValue={c.email ?? ""} onBlur={(e) => e.target.value !== (c.email ?? "") && patch(c.id, { email: e.target.value })}
                    placeholder="Email" className="h-7 text-[12px] pl-7" />
                </span>
              </div>
            </li>
          ))}
          {contacts.length === 0 && <li className="text-[12px] italic text-muted-foreground">Aucun interlocuteur enregistré.</li>}
        </ul>
      )}

      {/* Ajout */}
      <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Input value={newC.name} onChange={(e) => setNewC((c) => ({ ...c, name: e.target.value }))} placeholder="Nom de l'interlocuteur" className="h-8 text-[13px] flex-1" />
          <TypeCombobox kind="contact" value={newC.role || null} onChange={(role) => setNewC((c) => ({ ...c, role }))} placeholder="Type / poste" className="w-44" />
        </div>
        <div className="flex items-center gap-2">
          <Input value={newC.phone} onChange={(e) => setNewC((c) => ({ ...c, phone: e.target.value }))} placeholder="Téléphone" className="h-8 text-[12px] flex-1 font-mono" />
          <Input value={newC.email} onChange={(e) => setNewC((c) => ({ ...c, email: e.target.value }))} placeholder="Email" className="h-8 text-[12px] flex-1" />
          <Button size="sm" onClick={add} disabled={adding || !newC.name.trim()}>
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Ajouter
          </Button>
        </div>
      </div>
    </div>
  );
}
