"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Mail, KeyRound, AlertTriangle } from "lucide-react";

interface State {
  from: string;
  testRecipient: string;
  live: boolean;
  sapUser: string;
  sapUserIsOverride: boolean;
  sapPassIsSet: boolean;
}

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function IntegrationSettingsPanel() {
  const [s, setS] = useState<State | null>(null);
  const [sapPass, setSapPass] = useState(""); // saisie séparée (jamais préremplie)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/integration-settings", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Chargement impossible");
      setS(j);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (!s) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        from: s.from,
        testRecipient: s.testRecipient,
        live: s.live,
        sapUser: s.sapUser,
      };
      if (sapPass !== "") body.sapPass = sapPass; // n'envoie le mot de passe que s'il est saisi
      const r = await fetch("/api/admin/integration-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Enregistrement impossible");
      setS(j);
      setSapPass("");
      toast.success("Réglages enregistrés.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [s, sapPass]);

  if (loading || !s) {
    return <div className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>;
  }

  return (
    <div className="space-y-5">
      {/* ── Envoi des relances ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-brand-500" />
          <h4 className="text-[13px] font-bold text-foreground">Envoi des relances</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Boîte expéditrice" hint="Adresse « De » des courriers (boîte partagée).">
            <input className={inputCls} type="email" value={s.from} onChange={(e) => setS({ ...s, from: e.target.value })} placeholder="compta@gervifrais.com" />
          </Field>
          <Field label="Destinataire de test" hint="Où partent les relances tant que le mode live est désactivé.">
            <input className={inputCls} type="email" value={s.testRecipient} onChange={(e) => setS({ ...s, testRecipient: e.target.value })} placeholder="test@…" />
          </Field>
        </div>
        <label className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 cursor-pointer">
          <input type="checkbox" checked={s.live} onChange={(e) => setS({ ...s, live: e.target.checked })} className="h-4 w-4 mt-0.5 accent-brand-600" />
          <span className="text-[12.5px]">
            <b className="text-foreground">Envoi RÉEL aux clients</b>
            <span className="text-muted-foreground"> — décoché (recommandé), toutes les relances vont au destinataire de test. Coché, elles partent aux emails compta des clients.</span>
          </span>
        </label>
      </div>

      {/* ── Identifiants SAP ── */}
      <div className="space-y-3 border-t border-border/60 pt-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-brand-500" />
          <h4 className="text-[13px] font-bold text-foreground">Utilisateur SAP référent</h4>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/25 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Ces identifiants authentifient <b>toute</b> la synchro SAP. En cas d&apos;erreur, videz les deux champs et enregistrez : on repart automatiquement sur l&apos;utilisateur d&apos;origine (env).</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Utilisateur (UserName)" hint={s.sapUserIsOverride ? "Surcharge active." : "Actuellement : valeur d'origine (env)."}>
            <input className={inputCls} value={s.sapUser} onChange={(e) => setS({ ...s, sapUser: e.target.value })} placeholder="GERMM" />
          </Field>
          <Field label="Mot de passe" hint={s.sapPassIsSet ? "Un mot de passe est enregistré. Laissez vide pour le conserver." : "Laissez vide pour garder celui d'origine (env)."}>
            <input className={inputCls} type="password" value={sapPass} onChange={(e) => setSapPass(e.target.value)} placeholder={s.sapPassIsSet ? "•••••••• (inchangé)" : "•••••••• (env)"} autoComplete="new-password" />
          </Field>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
        </button>
      </div>
    </div>
  );
}
