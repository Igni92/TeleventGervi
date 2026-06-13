"use client";

import { broadcastPilotage } from "@/lib/pilotageSync";
import type { Granularity } from "@/lib/pilotage";

const OPTIONS: { v: Granularity; label: string }[] = [
  { v: "day",   label: "Jour" },
  { v: "week",  label: "Sem." },
  { v: "month", label: "Mois" },
  { v: "year",  label: "Année" },
];

/**
 * Switch granularité — pilote le bento et diffuse vers l'autre écran via
 * [[pilotageSync]]. `allowed` restreint les options (ex: écran 1 = J/S/M sans
 * Année car ça n'a pas de sens en pilotage opérationnel ; écran 2 = M/A).
 */
export function GranularitySwitch({
  value, onChange, broadcastOnChange = true, allowed,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
  broadcastOnChange?: boolean;
  allowed?: Granularity[];
}) {
  const shown = allowed ? OPTIONS.filter((o) => allowed.includes(o.v)) : OPTIONS;
  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-md">
      {shown.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => {
              onChange(o.v);
              if (broadcastOnChange) broadcastPilotage({ g: o.v });
            }}
            className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
