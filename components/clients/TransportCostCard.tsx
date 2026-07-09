import Link from "next/link";
import { TrendingDown } from "lucide-react";

/**
 * Carte « Coût transport » de la fiche client — reporte la VALEUR ANNUELLE du
 * prix position (€/kg) de la livraison EN DIRECT (flotte propre). Purement
 * présentationnelle (server component) : le calcul vient de lib/transportCost
 * côté page.
 *
 * On se base sur le TRANSPORTEUR, pas sur le type de client : seules les
 * livraisons en direct sont valorisées au prix position ; les livraisons via un
 * transporteur externe utilisent une valeur €/kg saisie à la main (par
 * transporteur, page Coût de transport). Hebdomadaire / mensuel ne sont donnés
 * qu'à titre indicatif dans les états — c'est bien l'ANNUEL qui est reporté ici.
 */
export function TransportCostCard({
  perKg,
  configured,
}: {
  /** Prix position €/kg (livraison directe). */
  perKg: number;
  /** Le prix position est-il paramétré (kg/an > 0) ? */
  configured: boolean;
}) {
  const fmtPerKg = (v: number) =>
    `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v)} €/kg`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[26px] font-bold tnum leading-none text-brand-600 dark:text-brand-400 inline-flex items-center gap-1.5">
          <TrendingDown className="h-5 w-5" />
          {configured ? fmtPerKg(perKg) : "—"}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">annuel · direct</span>
      </div>

      {configured ? (
        <p className="text-[12px] text-muted-foreground">
          Prix position — coût de la livraison <span className="font-medium text-foreground">en direct</span> (flotte propre) au
          kilo, déduit de la marge sur chaque vente livrée en direct :{" "}
          <span className="tnum font-medium text-foreground">{fmtPerKg(perKg)}</span> × kg livrés.
        </p>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Prix position non encore paramétré. À définir dans{" "}
          <Link href="/transport" className="text-brand-600 dark:text-brand-400 hover:underline">Coût de transport</Link>.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground/80">
        Livraison via transporteur externe : tarif €/kg saisi ci-dessous, par transporteur.
        Valeur du direct évolutive — Pilotage ›{" "}
        <Link href="/transport" className="hover:underline">Coût de transport</Link>.
      </p>
    </div>
  );
}
