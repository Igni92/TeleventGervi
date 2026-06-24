"use client";

import { Boxes, Scale, History } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ClientLink } from "@/components/ClientLink";
import { useJson } from "./use-json";

/**
 * Dernières commandes SAP créées (GET /api/sap/orders?last=8).
 *
 * Présentation demandée : les icônes (colis / poids) apparaissent UNE seule fois
 * en tête de colonne ; chaque ligne ne porte QUE les valeurs, dans deux tags
 * bleus (nb de colis · poids kg).
 */

interface OrderDoc {
  docEntry?: number;
  docNum?: number;
  docDate?: string;
  cardCode?: string;
  cardName?: string;
  colis?: number | null;
  weightKg?: number | null;
}
interface OrdersResponse { docs?: OrderDoc[] }

/** « 14:32 » si l'horodatage porte une heure, sinon « 12/06 ». */
function whenOf(d: OrderDoc): string {
  if (!d.docDate) return "—";
  const dt = new Date(d.docDate);
  if (Number.isNaN(dt.getTime())) return "—";
  const hasTime = dt.getHours() !== 0 || dt.getMinutes() !== 0;
  return hasTime
    ? dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const TAG = "inline-flex items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 px-2 h-5 min-w-[2.25rem] text-[11px] font-semibold tnum";

export function DernieresCommandes() {
  const { data, state } = useJson<OrdersResponse>("/api/sap/orders?last=8", 60_000);
  const docs = (data?.docs ?? []).slice(0, 8);

  return (
    <SurfaceCard title="Dernières commandes" icon={<History className="h-3.5 w-3.5" />} accent="sky" delay={140}>
      {state === "loading" && (
        <ul className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => <li key={i} className="h-8 rounded-lg bg-secondary/60 animate-pulse" />)}
        </ul>
      )}

      {state === "error" && (
        <p className="text-[12px] text-muted-foreground py-3 text-center">Commandes SAP indisponibles pour le moment.</p>
      )}

      {state === "ok" && docs.length === 0 && (
        <p className="text-[12px] text-muted-foreground py-3 text-center">Aucune commande récente.</p>
      )}

      {state === "ok" && docs.length > 0 && (
        <>
          {/* En-tête de colonnes : icônes une seule fois */}
          <div className="flex items-center gap-3 pb-1.5 mb-0.5 border-b border-border/60 text-muted-foreground">
            <span className="w-[52px] shrink-0" />
            <span className="flex-1 min-w-0" />
            <span className="w-12 shrink-0 flex justify-center" title="Nombre de colis"><Boxes className="h-4 w-4" /></span>
            <span className="w-14 shrink-0 flex justify-center" title="Poids (kg)"><Scale className="h-4 w-4" /></span>
          </div>
          <ul className="divide-y divide-border/60">
            {docs.map((d) => (
              <li key={d.docEntry ?? `${d.docNum}-${d.cardCode}`} className="flex items-center gap-3 py-1.5">
                <span className="tnum shrink-0 w-[52px] text-[11px] font-medium text-muted-foreground">{whenOf(d)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {d.cardCode ? <ClientLink code={d.cardCode} name={d.cardName} preferCode /> : (d.cardName ?? "—")}
                </span>
                <span className="w-12 shrink-0 flex justify-center">
                  {d.colis != null && d.colis > 0 ? <span className={TAG}>{fmtNum(d.colis)}</span> : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                </span>
                <span className="w-14 shrink-0 flex justify-center">
                  {d.weightKg != null && d.weightKg > 0 ? <span className={TAG}>{fmtNum(d.weightKg)} kg</span> : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SurfaceCard>
  );
}
