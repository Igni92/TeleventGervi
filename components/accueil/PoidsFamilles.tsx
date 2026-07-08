"use client";

import { useEffect, useRef, useState } from "react";
import { Scale, Plus, X, ChevronDown } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { FRUIT_FAMILIES } from "@/lib/familles";
import { useJson } from "./use-json";

/**
 * Poids VENDU aujourd'hui par FAMILLE de fruit — tuiles CHOISIES par le poste
 * (fraise + framboise par défaut). La sélection est mémorisée par appareil
 * (localStorage) ; on ajoute/retire un fruit via le sélecteur « Ajouter un fruit »
 * ou la croix d'une tuile. Source : GET /api/accueil/poids-familles.
 */

const KEY = "televent-accueil-familles";
const DEFAULT_SELECTION = ["fraise", "framboise"];

interface FamilyWeight { key: string; label: string; weightKg: number }
interface Resp { families?: FamilyWeight[] }

function useSelectedFamilies() {
  const [sel, setSel] = useState<string[]>(DEFAULT_SELECTION);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const a = raw ? JSON.parse(raw) : null;
      if (Array.isArray(a)) setSel(a.filter((x) => typeof x === "string"));
    } catch { /* défaut */ }
    setLoaded(true);
  }, []);
  const save = (next: string[]) => {
    setSel(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
  };
  return {
    sel, loaded,
    add: (k: string) => { if (!sel.includes(k)) save([...sel, k]); },
    remove: (k: string) => save(sel.filter((x) => x !== k)),
  };
}

export function PoidsFamilles() {
  const { data, state } = useJson<Resp>("/api/accueil/poids-familles", 120_000);
  const { sel, loaded, add, remove } = useSelectedFamilies();
  const [pickOpen, setPickOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setPickOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const byKey = new Map((data?.families ?? []).map((f) => [f.key, f]));
  // Familles connues : les 6 fruits + toute famille supplémentaire renvoyée (ventes).
  const known = [
    ...FRUIT_FAMILIES,
    ...(data?.families ?? [])
      .filter((f) => !FRUIT_FAMILIES.some((x) => x.key === f.key))
      .map((f) => ({ key: f.key, label: f.label })),
  ];
  const labelOf = (k: string) => byKey.get(k)?.label ?? known.find((x) => x.key === k)?.label ?? k;
  const shown = loaded ? sel : DEFAULT_SELECTION;
  const available = known.filter((f) => !shown.includes(f.key));

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Scale className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] leading-none">
            Poids vendu par fruit · aujourd&apos;hui
          </span>
        </div>
        <div ref={boxRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPickOpen((o) => !o)}
            disabled={available.length === 0}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border bg-card text-[11.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter un fruit <ChevronDown className={`h-3 w-3 transition-transform ${pickOpen ? "rotate-180" : ""}`} />
          </button>
          {pickOpen && available.length > 0 && (
            <div className="absolute right-0 z-50 mt-1 w-44 rounded-xl border border-border bg-card shadow-xl overflow-hidden py-1">
              {available.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => { add(f.key); setPickOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-secondary/60 transition-colors"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map((k) => {
          const w = byKey.get(k)?.weightKg ?? 0;
          return (
            <div key={k} className="relative rounded-2xl border border-border bg-card px-4 py-3.5 shadow-card">
              <button
                type="button"
                onClick={() => remove(k)}
                title={`Retirer ${labelOf(k)}`}
                aria-label={`Retirer ${labelOf(k)}`}
                className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:text-rose-500 hover:bg-secondary/60 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <span className="block text-[12px] font-semibold text-foreground/85 pr-6 truncate">{labelOf(k)}</span>
              {state === "loading" ? (
                <div className="mt-2.5 h-[24px] w-20 rounded-md bg-secondary/70 animate-pulse" />
              ) : (
                <div className="mt-2 font-display text-[24px] font-bold text-foreground leading-none tnum">
                  {state === "error"
                    ? <span className="text-muted-foreground">—</span>
                    : <AnimatedNumber value={Math.round(w)} suffix=" kg" />}
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/50 px-4 py-5 text-center text-[12.5px] text-muted-foreground">
            Aucun fruit sélectionné — utilise « Ajouter un fruit ».
          </div>
        )}
      </div>
    </div>
  );
}
