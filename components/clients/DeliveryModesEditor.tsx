"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Star, Trash2, Truck, Loader2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";

interface Mode {
  id: string;
  name: string;
  sapCardCode: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface Props {
  clientId: string;
  clientCode: string;
}

export function DeliveryModesEditor({ clientId, clientCode }: Props) {
  const [modes, setModes] = useState<Mode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/delivery-modes`);
      const json = await res.json();
      setModes(json.modes ?? []);
    } catch { toast.error("Erreur de chargement des modes"); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { refresh(); }, [refresh]);

  // If empty after load, ensure there's a "Direct" default (auto-create UX)
  useEffect(() => {
    if (loading || modes.length > 0) return;
    // Create Direct mode with the client's own code
    create("Direct", clientCode, true).then(() => refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, modes.length]);

  const create = async (name: string, sapCardCode: string, isDefault: boolean) => {
    setCreating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/delivery-modes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sapCardCode, isDefault }),
      });
      if (!res.ok) throw new Error();
      setNewName(""); setNewCode("");
      await refresh();
    } catch { toast.error("Erreur création"); }
    finally { setCreating(false); }
  };

  const setDefault = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/clients/${clientId}/delivery-modes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      await refresh();
    } catch { toast.error("Erreur"); }
    finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce mode ?")) return;
    setBusy(id);
    try {
      await fetch(`/api/clients/${clientId}/delivery-modes/${id}`, { method: "DELETE" });
      await refresh();
    } catch { toast.error("Erreur"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Truck className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-foreground">Modes de livraison</h3>
        <InfoTip
          label="Modes de livraison"
          content={<>Chaque mode pointe vers un <b>CardCode SAP</b> différent.<br/>Ex : <b>Direct</b> utilise LPOI · <b>SCACHAP</b> utilise LPOI.<br/>Le mode <b>défaut</b> est sélectionné automatiquement lors de la création d&apos;un BL.</>}
          side="right" iconSize={11}
        />
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <ul className="space-y-1.5">
          {modes.map((m) => (
            <li
              key={m.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                m.isDefault
                  ? "border-brand-300/60 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-950/20"
                  : "border-border bg-card hover:border-foreground/20"
              }`}
            >
              <button
                type="button"
                onClick={() => !m.isDefault && setDefault(m.id)}
                disabled={busy === m.id}
                title={m.isDefault ? "Mode par défaut" : "Définir par défaut"}
                className={`h-6 w-6 inline-flex items-center justify-center rounded transition-colors ${
                  m.isDefault
                    ? "text-amber-500 cursor-default"
                    : "text-muted-foreground/40 hover:text-amber-500 hover:bg-secondary/60"
                }`}
              >
                <Star className="h-3.5 w-3.5" fill={m.isDefault ? "currentColor" : "none"} />
              </button>

              <div className="flex-1 min-w-0 flex items-center gap-3">
                <span className="text-[13px] font-medium text-foreground">{m.name}</span>
                <span className="text-[10.5px] text-muted-foreground">→ SAP CardCode :</span>
                <span className="text-[11.5px] font-mono font-semibold text-foreground/90 px-1.5 py-0.5 rounded bg-secondary/50">
                  {m.sapCardCode}
                </span>
              </div>

              <button
                type="button"
                onClick={() => remove(m.id)}
                disabled={busy === m.id}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/40 hover:text-rose-500 hover:bg-secondary/60 transition-colors"
                title="Supprimer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add new mode */}
      <form
        className="flex items-center gap-1.5 mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim() && newCode.trim()) create(newName.trim(), newCode.trim(), modes.length === 0);
        }}
      >
        <Input
          placeholder="Nom (ex: SCACHAP)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="h-8 text-[12px] flex-1"
        />
        <Input
          placeholder="Code SAP (ex: LPOI.)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          className="h-8 text-[12px] font-mono w-40"
        />
        <Button type="submit" size="sm" disabled={creating || !newName.trim() || !newCode.trim()}>
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Ajouter
        </Button>
      </form>
    </div>
  );
}
