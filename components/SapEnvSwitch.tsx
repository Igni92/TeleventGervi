"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface EnvState {
  env: "prod" | "test";
  company: string;
  testCompany: string;
  prodCompany: string;
  testConfigured: boolean;
}

/**
 * Badge environnement SAP + **bouton de bascule prod ↔ test à chaud**.
 *
 * L'état vient du serveur (/api/sap/environment), pas d'un env build-time : un
 * clic bascule la société SAP cible pour TOUTES les écritures (commandes, BL,
 * réceptions, production). Confirmation explicite avant de basculer.
 */
export function SapEnvSwitch() {
  const [state, setState] = useState<EnvState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sap/environment", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setState(j);
    } catch { /* silencieux — badge masqué */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!state) return null;
  const isTest = state.env === "test";
  const target = isTest ? "prod" : "test";
  const targetCompany = target === "test" ? state.testCompany : state.prodCompany;

  const toggle = async () => {
    if (busy) return;
    if (target === "test" && !state.testConfigured) {
      toast.error("Environnement TEST non configuré (SAP_B1_COMPANY_DB_TEST manquant).");
      return;
    }
    const ok = window.confirm(
      `Basculer SAP vers ${target.toUpperCase()} (${targetCompany || "?"}) ?\n\n` +
      `⚠️ Toutes les écritures suivantes — commandes, BL, réceptions, production — ` +
      `iront sur cette base.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch("/api/sap/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: target }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec de la bascule"); return; }
      setState(j);
      toast.success(`SAP → ${j.env.toUpperCase()} · ${j.company}`, { duration: 6000 });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={`Base SAP : ${state.company} — clic pour basculer vers ${target.toUpperCase()}`}
      className={`shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11px] font-semibold tracking-wide select-none transition-colors disabled:opacity-70 ${
        isTest
          ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40 hover:bg-amber-500/30"
          : "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25"
      }`}
    >
      {busy
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <span className={`h-1.5 w-1.5 rounded-full ${isTest ? "bg-amber-400 animate-soft-pulse" : "bg-emerald-400"}`} />}
      {isTest ? `SAP TEST · ${state.company}` : `SAP PROD · ${state.company}`}
    </button>
  );
}
