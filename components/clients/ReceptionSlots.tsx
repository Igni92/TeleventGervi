"use client";

import { useEffect, useState } from "react";
import { Loader2, Clock, MapPin, Timer, AlertTriangle } from "lucide-react";

type Logistics = {
  gpsLat: string | number | null;
  gpsLon: string | number | null;
  recepDeb1: string | number | null;
  recepFin1: string | number | null;
  recepDeb2: string | number | null;
  recepFin2: string | number | null;
  tpsCharg: string | number | null;
};

/** Formate une heure de réception SAP (smallint HHMM : 830 → 08:30, 1730 → 17:30).
 *  0 (ou négatif) = créneau non renseigné → null. */
function fmtTime(v: string | number | null): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^-?\d+$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;   // 0 / négatif = non renseigné
    const h = Math.floor(n / 100), m = n % 100;
    if (h > 23 || m > 59) return String(v);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return String(v).trim();
}

/** Créneau « déb – fin » (null si aucun des deux). */
function slot(deb: string | number | null, fin: string | number | null): string | null {
  const a = fmtTime(deb), b = fmtTime(fin);
  if (!a && !b) return null;
  return `${a ?? "—"} – ${b ?? "—"}`;
}

const num = (v: string | number | null): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/**
 * Créneaux de réception + coordonnées GPS + temps de chargement du magasin,
 * lus dans SAP (BusinessPartner). Lecture seule — réservé livreur/direction/admin.
 */
export function ReceptionSlots({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Logistics | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/clients/${clientId}/logistics-sap`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !j?.ok) { setError(j?.error || "Chargement impossible"); setState("error"); return; }
        setData(j.logistics as Logistics);
        setState("ok");
      })
      .catch(() => { if (!cancelled) { setError("SAP injoignable"); setState("error"); } });
    return () => { cancelled = true; };
  }, [clientId]);

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 py-3 text-[12.5px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des créneaux…
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex items-center gap-2 py-2 text-[12.5px] text-rose-600 dark:text-rose-400">
        <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }

  const s1 = slot(data?.recepDeb1 ?? null, data?.recepFin1 ?? null);
  const s2 = slot(data?.recepDeb2 ?? null, data?.recepFin2 ?? null);
  const lat = num(data?.gpsLat ?? null), lon = num(data?.gpsLon ?? null);
  // Temps de chargement = un nombre de MINUTES (smallint), pas une heure HHMM.
  const tpsMin = num(data?.tpsCharg ?? null);
  const tps = tpsMin != null ? `${tpsMin} min` : null;
  const hasAny = s1 || s2 || (lat != null && lon != null) || tps;

  if (!hasAny) {
    return <p className="py-2 text-[12.5px] italic text-muted-foreground">Aucune information logistique renseignée dans SAP pour ce magasin.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Créneaux de réception */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Créneaux de réception
        </p>
        {s1 || s2 ? (
          <div className="flex flex-wrap gap-2">
            {s1 && <span className="inline-flex items-center rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[13px] font-semibold tnum text-foreground">{s1}</span>}
            {s2 && <span className="inline-flex items-center rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[13px] font-semibold tnum text-foreground">{s2}</span>}
          </div>
        ) : (
          <p className="text-[12.5px] italic text-muted-foreground">Non renseignés.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {/* Temps de chargement */}
        {tps && (
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Timer className="h-3.5 w-3.5" /> Temps de chargement
            </p>
            <p className="text-[13.5px] font-semibold tnum text-foreground">{tps}</p>
          </div>
        )}

        {/* GPS */}
        {lat != null && lon != null && (
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Coordonnées GPS
            </p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold tnum text-brand-600 dark:text-brand-400 hover:underline"
            >
              {lat.toFixed(5)}, {lon.toFixed(5)}
              <MapPin className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
