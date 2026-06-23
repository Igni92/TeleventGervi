"use client";

import { useEffect, useState, useTransition } from "react";
import { Save, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Groupe client SAP — édition BIDIRECTIONNELLE (écrit le GroupCode sur le
 * BusinessPartner SAP, qui pilote le coefficient de prix conseillé, puis met à
 * jour le cache local). Le groupe est lu depuis SAP ; on peut désormais le
 * changer ici.
 */
interface GroupOpt { code: number; name: string }

export function ClientGroupEditor({
  clientId, initialCode, initialName,
}: {
  clientId: string;
  initialCode: number | null;
  initialName: string | null;
}) {
  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const [code, setCode] = useState<number | null>(initialCode);
  const [savedCode, setSavedCode] = useState<number | null>(initialCode);
  const [savedName, setSavedName] = useState<string | null>(initialName);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sap/business-partner-groups")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d.groups)) setGroups(d.groups); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
      toast.success("Groupe mis à jour (SAP + local)");
    });
  }

  return (
    <div className="space-y-2">
      <Label className="inline-flex items-center gap-1.5">
        <Tags className="h-3.5 w-3.5 text-muted-foreground" /> Groupe client SAP
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value={code != null ? String(code) : undefined}
          onValueChange={(v) => setCode(Number(v))}
        >
          <SelectTrigger className="h-9 flex-1">
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
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={onSave} className="gap-1.5 shrink-0">
          <Save className="h-3.5 w-3.5" />
          {saving ? "…" : "Enregistrer"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Le groupe pilote le coefficient de prix conseillé — la modification est écrite dans SAP.
      </p>
    </div>
  );
}
