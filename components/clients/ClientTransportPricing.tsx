"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { normCarrier } from "@/lib/transportCost";
import type { CarrierTariff, CarrierTariffMap } from "@/lib/carrierTariff";
import { CarrierTariffEditor } from "@/components/clients/CarrierTariffEditor";
import { CarrierTariffImport } from "@/components/transport/CarrierTariffImport";

/**
 * Coût transport de la fiche client — PAR TRANSPORTEUR.
 *
 *   • Transporteur DIRECT (flotte propre) : prix position €/kg — affiché
 *     UNIQUEMENT si ce magasin peut être livré en direct (le prix direct n'est
 *     plus un en-tête global de la fiche).
 *   • Transporteur EXTERNE : GRILLE tarifaire au COÛT PAR POSITION — tranches
 *     de poids modifiables × départements livrés + lignes fixes (€) et en %
 *     (majoration gazole…). La grille est GLOBALE au transporteur (partagée
 *     entre clients) ; le département du client montre la zone applicable.
 *
 * Best-effort : si l'historique SAP du client est indisponible, on retombe sur
 * le catalogue complet des transporteurs.
 */

interface CarrierOpt { code: string; name: string }

export function ClientTransportPricing({
  clientId,
  canEdit,
  directPerKg = 0,
}: {
  clientId: string;
  canEdit: boolean;
  /** Prix position €/kg (livraison directe) — affiché sur les transporteurs directs du client. */
  directPerKg?: number;
}) {
  const [carriers, setCarriers] = useState<CarrierOpt[]>([]);
  const [directSet, setDirectSet] = useState<Set<string>>(new Set());
  const [tariffs, setTariffs] = useState<CarrierTariffMap>({});
  const [departement, setDepartement] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // 1) Transporteurs du client (repli catalogue complet), 2) directs,
    // 3) grilles tarifaires + département du client (transport-pricing).
    const [carriersRes, modelRes, pricingRes] = await Promise.allSettled([
      (async () => {
        const r = await fetch(`/api/clients/${clientId}/carriers`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        let list: CarrierOpt[] = ((j?.carriers ?? []) as { name: string; sapValue?: string | null }[])
          .filter((c) => c.sapValue && c.sapValue.trim())
          .map((c) => ({ code: c.sapValue!.trim(), name: c.name || c.sapValue!.trim() }));
        if (list.length === 0) {
          const r2 = await fetch(`/api/carriers`, { cache: "no-store" });
          const j2 = await r2.json().catch(() => null);
          list = ((j2?.carriers ?? []) as { name: string; sapValue?: string | null; active?: boolean }[])
            .filter((c) => c.active !== false && c.sapValue && c.sapValue.trim())
            .map((c) => ({ code: c.sapValue!.trim(), name: c.name || c.sapValue!.trim() }));
        }
        return list;
      })(),
      fetch(`/api/transport/model`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/clients/${clientId}/transport-pricing`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (carriersRes.status === "fulfilled") setCarriers(carriersRes.value);
    if (modelRes.status === "fulfilled" && Array.isArray(modelRes.value?.model?.directCarriers)) {
      setDirectSet(new Set((modelRes.value.model.directCarriers as string[]).map(normCarrier)));
    }
    if (pricingRes.status === "fulfilled") {
      if (pricingRes.value?.tariffs) setTariffs(pricingRes.value.tariffs as CarrierTariffMap);
      setDepartement(typeof pricingRes.value?.departement === "string" ? pricingRes.value.departement : null);
    }
  }, [clientId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  if (loading) {
    return <div className="h-16 flex items-center text-[12px] text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Chargement des transporteurs…</div>;
  }

  const external = carriers.filter((c) => !directSet.has(normCarrier(c.code)));
  const directOnes = carriers.filter((c) => directSet.has(normCarrier(c.code)));
  const fmtPerKg = (v: number) =>
    `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v)} €/kg`;

  return (
    <div className="space-y-3">
      {/* Livraison directe — seulement pour les magasins livrables en direct. */}
      {directOnes.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground inline-flex items-center gap-1.5 mb-1.5">
            <Truck className="h-3.5 w-3.5" /> Livraison directe (flotte propre)
          </p>
          <ul className="space-y-1">
            {directOnes.map((c) => (
              <li key={normCarrier(c.code)} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-foreground">{c.name}</span>
                <span className="shrink-0 text-[11px] font-semibold text-brand-600 dark:text-brand-400 inline-flex items-center gap-1 tnum">
                  <Truck className="h-3 w-3" /> Direct · prix position{directPerKg > 0 ? ` ${fmtPerKg(directPerKg)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transporteurs externes — grille au coût PAR POSITION. */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" /> Tarif par transporteur externe — coût par position
          </p>
          {/* Import du fichier tarif fournisseur : remplit la grille pour TOUS les clients. */}
          {canEdit && <CarrierTariffImport onImported={() => void load()} />}
        </div>
        {carriers.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Aucun transporteur connu pour ce client.</p>
        ) : external.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Client livré uniquement en direct.</p>
        ) : (
          <div className="space-y-1.5">
            {external.map((c) => {
              const k = normCarrier(c.code);
              return (
                <CarrierTariffEditor
                  // updatedAt dans la clé : un import/enregistrement remonte
                  // l'éditeur avec la grille fraîche (état local sinon figé).
                  key={`${k}:${tariffs[k]?.updatedAt ?? "vide"}`}
                  carrierCode={k}
                  carrierName={c.name}
                  initialTariff={tariffs[k] ?? null}
                  clientDept={departement}
                  canEdit={canEdit}
                  onSaved={(t: CarrierTariff) => setTariffs((m) => ({ ...m, [k]: t }))}
                />
              );
            })}
          </div>
        )}
        <p className="text-[10.5px] text-muted-foreground/80 mt-2">
          Coût d&apos;une livraison = prix de la tranche de poids (selon le département livré) + majorations (%)
          et frais fixes. Les grilles sont partagées entre tous les clients du transporteur.
        </p>
      </div>
    </div>
  );
}
