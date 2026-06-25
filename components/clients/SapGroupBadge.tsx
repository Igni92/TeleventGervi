"use client";

import { useEffect, useState, useTransition } from "react";
import { Tag, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Groupe SAP — badge compact ET éditable (remplace l'ancien gros menu déroulant
 * `ClientGroupEditor`). Affiche le groupe sous forme de chip « {nom} #{code} » ;
 * « modifier » bascule en édition (menu + Enregistrer). La sauvegarde est
 * BIDIRECTIONNELLE : écrit le GroupCode sur le BusinessPartner SAP (qui pilote le
 * coefficient de prix conseillé) puis met à jour le cache local.
 *
 * Même composant sur la fiche client et la console d'appel.
 */
interface GroupOpt { code: number; name: string }

export function SapGroupBadge({
  clientId, initialCode, initialName,
}: {
  clientId: string;
  initialCode: number | null;
  initialName: string | null;
}) {
  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState<number | null>(initialCode);
  const [savedCode, setSavedCode] = useState<number | null>(initialCode);
  const [savedName, setSavedName] = useState<string | null>(initialName);
  const [saving, startSave] = useTransition();

  // Resync quand le client actif change (console multi-clients).
  useEffect(() => {
    setCode(initialCode);
    setSavedCode(initialCode);
    setSavedName(initialName);
    setEditing(false);
  }, [clientId, initialCode, initialName]);

  // Charge la liste des groupes seulement à la 1re entrée en édition.
  useEffect(() => {
    if (!editing || groups.length > 0) return;
    let cancelled = false;
    fetch("/api/sap/business-partner-groups")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d.groups)) setGroups(d.groups); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [editing, groups.length]);

  const dirty = code !== savedCode && code != null;

  function onSave() {
    if (code == null) return;
    startSave(async () => {
      const res = await fetch(`/api/clients/${clientId}/sap-group`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupCode: code }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { toast.error(d?.error ?? `Erreur ${res.status}`); return; }
      setSavedCode(d.sapGroupCode ?? code);
      setSavedName(d.sapGroupName ?? null);
      setEditing(false);
      toast.success("Groupe mis à jour (SAP + local)");
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
        <Tag className="h-3 w-3" /> Groupe SAP
      </div>

      {editing ? (
        <div className="flex items-center gap-2">
          <Select
            value={code != null ? String(code) : undefined}
            onValueChange={(v) => setCode(Number(v))}
          >
            <SelectTrigger className="h-8 flex-1 text-[12.5px]">
              <SelectValue placeholder={savedName ?? "Choisir un groupe…"} />
            </SelectTrigger>
            <SelectContent>
              {groups.length === 0 && savedCode != null && (
                <SelectItem value={String(savedCode)}>{savedName ?? `Groupe ${savedCode}`}</SelectItem>
              )}
              {groups.map((g) => (
                <SelectItem key={g.code} value={String(g.code)}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={!dirty || saving}
            onClick={onSave}
            className="h-8 px-2.5 gap-1.5 shrink-0"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "…" : "Enregistrer"}
          </Button>
          <button
            type="button"
            onClick={() => { setCode(savedCode); setEditing(false); }}
            className="text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {savedName ? (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-secondary/40 text-[12px]"
              title="Le groupe pilote le coefficient de prix conseillé — la modification est écrite dans SAP."
            >
              <span className="font-medium text-foreground">{savedName}</span>
              {savedCode != null && (
                <span className="font-mono text-[10.5px] text-muted-foreground">#{savedCode}</span>
              )}
            </span>
          ) : (
            <span className="text-[11.5px] italic text-muted-foreground">— non synchronisé —</span>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] text-muted-foreground hover:text-brand-600"
          >
            modifier
          </button>
        </div>
      )}
    </div>
  );
}
