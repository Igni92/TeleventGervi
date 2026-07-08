"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reconstruction de l'historique SAP (miroir comptable) MOIS PAR MOIS.
 *
 * Pourquoi cette grille plutôt qu'un bouton unique : `/sync/full-reset` fait
 * TRUNCATE puis re-pull 3 ans dans UNE requête plafonnée à 300 s par Vercel →
 * sur un gros historique il se fait tuer après quelques mois (récent d'abord),
 * VIDE tout mais ne remplit que le récent (2024/2025 jamais atteints).
 *
 * Ici : chaque mois est un appel `/sync/backfill?from=…&to=…` INDÉPENDANT et
 * ADDITIF (n'efface rien). Un mois = ~1 min, jamais de timeout. On clique les
 * mois manquants à son rythme ; le clic sur l'année enchaîne ses 12 mois.
 * Upsert idempotent par DocEntry → recliquer un mois le rafraîchit sans doublon.
 */

type Status = "idle" | "loading" | "done" | "error";

const MONTHS_FR = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

export function MirrorBackfillPanel() {
  const router = useRouter();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const years = [currentYear - 2, currentYear - 1, currentYear];

  const [status, setStatus] = useState<Record<string, Status>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});

  const key = (y: number, m: number) => `${y}-${m}`;

  /** Importe UN mois (from=1er → to=dernier jour). Renvoie true si OK. */
  const importMonth = async (y: number, m: number): Promise<boolean> => {
    const k = key(y, m);
    const from = `${y}-${pad(m + 1)}-01`;
    const to = `${y}-${pad(m + 1)}-${pad(lastDay(y, m))}`;
    setStatus((s) => ({ ...s, [k]: "loading" }));
    try {
      const r = await fetch(`/api/sap/sync/backfill?from=${from}&to=${to}`, { method: "POST" });
      // Un 504 (timeout Vercel) renvoie du HTML → r.json() jette : on isole le mois.
      type BackfillResult = { ok?: boolean; invoices?: number };
      let j: BackfillResult | null = null;
      try { j = (await r.json()) as BackfillResult; } catch { j = null; }
      if (!r.ok || !j?.ok) {
        setStatus((s) => ({ ...s, [k]: "error" }));
        toast.error(`Échec ${MONTHS_FR[m]} ${y}`);
        return false;
      }
      setStatus((s) => ({ ...s, [k]: "done" }));
      setCounts((c) => ({ ...c, [k]: j!.invoices ?? 0 }));
      return true;
    } catch (e) {
      setStatus((s) => ({ ...s, [k]: "error" }));
      toast.error(`${MONTHS_FR[m]} ${y} : ${(e as Error).message}`);
      return false;
    }
  };

  const importOne = async (y: number, m: number) => {
    if (status[key(y, m)] === "loading") return;
    const ok = await importMonth(y, m);
    if (ok) { toast.success(`${MONTHS_FR[m]} ${y} importé`); router.refresh(); }
  };

  /** Enchaîne les mois d'une année (jusqu'au mois courant pour l'année en cours). */
  const importYear = async (y: number) => {
    const maxM = y === currentYear ? currentMonth : 11;
    let okCount = 0;
    for (let m = 0; m <= maxM; m++) {
      if (status[key(y, m)] === "done") { okCount++; continue; }
      if (await importMonth(y, m)) okCount++;
    }
    toast.success(`Année ${y} : ${okCount}/${maxM + 1} mois importés`);
    router.refresh();
  };

  const anyLoading = Object.values(status).some((s) => s === "loading");

  return (
    <div className="flex flex-col gap-2">
      {years.map((y) => {
        const maxM = y === currentYear ? currentMonth : 11;
        return (
          <div key={y} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => importYear(y)}
              disabled={anyLoading}
              className="w-12 shrink-0 rounded-md border border-border/60 py-1 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              title={`Importer tous les mois ${y}`}
            >
              {y}
            </button>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: 12 }, (_, m) => {
                const future = m > maxM;
                const k = key(y, m);
                const st: Status = status[k] ?? "idle";
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => importOne(y, m)}
                    disabled={future || st === "loading" || anyLoading}
                    title={
                      future ? "À venir"
                        : st === "done" ? `${counts[k] ?? 0} factures — recliquer pour rafraîchir`
                          : `Importer ${MONTHS_FR[m]} ${y}`
                    }
                    className={cn(
                      "flex h-6 w-11 items-center justify-center rounded border text-[11px] transition-colors",
                      future && "cursor-default border-transparent text-muted-foreground/30",
                      !future && st === "idle" && "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                      st === "loading" && "border-sky-400/50 bg-sky-400/10 text-sky-500",
                      st === "done" && "border-emerald-500/50 bg-emerald-500/10 text-emerald-600",
                      st === "error" && "border-red-500/50 bg-red-500/10 text-red-600",
                    )}
                  >
                    {future ? MONTHS_FR[m]
                      : st === "loading" ? <Loader2 className="h-3 w-3 animate-spin" />
                        : st === "done" ? <Check className="h-3 w-3" />
                          : st === "error" ? <AlertTriangle className="h-3 w-3" />
                            : MONTHS_FR[m]}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        Clique un <span className="text-foreground">mois</span> pour l&apos;importer (~1 min, jamais de timeout) ·
        clique l&apos;<span className="text-foreground">année</span> pour enchaîner ses mois ·
        <span className="text-emerald-600"> vert</span> = importé (recliquer = rafraîchir).
        L&apos;import est additif, il n&apos;efface rien.
      </p>
    </div>
  );
}
