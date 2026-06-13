"use client";

import { Boxes, History } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ClientLink } from "@/components/ClientLink";
import { useJson } from "./use-json";

/**
 * Dernières actions — dernières commandes SAP créées (GET /api/sap/orders?last=8).
 *
 * Volontairement SANS montant HT (écran partagé / visiteurs) : client cliquable,
 * heure (ou date + n° de pièce quand SAP ne porte pas l'heure) et nb de colis
 * si l'API l'expose (champ à venir — détection défensive).
 */

interface OrderDoc {
  docEntry?: number;
  docNum?: number;
  docDate?: string;
  cardCode?: string;
  cardName?: string;
  // nb de colis — champ annoncé côté API, noms possibles couverts défensivement
  colis?: number | null;
  nbColis?: number | null;
  packages?: number | null;
  packagesCount?: number | null;
}
interface OrdersResponse {
  docs?: OrderDoc[];
}

/** Premier champ « colis » renseigné, sinon null. */
function colisOf(d: OrderDoc): number | null {
  for (const v of [d.colis, d.nbColis, d.packages, d.packagesCount]) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

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

export function DernieresCommandes() {
  const { data, state } = useJson<OrdersResponse>("/api/sap/orders?last=8", 60_000);
  const docs = (data?.docs ?? []).slice(0, 8);

  return (
    <SurfaceCard
      title="Dernières commandes"
      icon={<History className="h-3.5 w-3.5" />}
      accent="sky"
      delay={140}
    >
      {state === "loading" && (
        <ul className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-8 rounded-lg bg-secondary/60 animate-pulse" />
          ))}
        </ul>
      )}

      {state === "error" && (
        <p className="text-[12px] text-muted-foreground py-3 text-center">
          Commandes SAP indisponibles pour le moment.
        </p>
      )}

      {state === "ok" && docs.length === 0 && (
        <p className="text-[12px] text-muted-foreground py-3 text-center">
          Aucune commande récente.
        </p>
      )}

      {state === "ok" && docs.length > 0 && (
        <ul className="divide-y divide-border/60">
          {docs.map((d) => {
            const colis = colisOf(d);
            return (
              <li key={d.docEntry ?? `${d.docNum}-${d.cardCode}`} className="flex items-center gap-3 py-1.5">
                <span className="tnum shrink-0 w-[52px] text-[11px] font-medium text-muted-foreground">
                  {whenOf(d)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {d.cardCode ? (
                    <ClientLink code={d.cardCode} name={d.cardName} />
                  ) : (
                    d.cardName ?? "—"
                  )}
                </span>
                {colis != null ? (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 px-2 h-5 text-[10.5px] font-semibold tnum">
                    <Boxes className="h-3 w-3" aria-hidden />
                    {colis} colis
                  </span>
                ) : (
                  d.docNum != null && (
                    <span className="shrink-0 text-[10.5px] text-muted-foreground tnum">
                      n° {d.docNum}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SurfaceCard>
  );
}
