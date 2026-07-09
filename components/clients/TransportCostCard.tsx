import Link from "next/link";
import { TrendingDown } from "lucide-react";

/**
 * Carte « Coût transport » de la fiche client — reporte la VALEUR ANNUELLE du
 * prix position (€/kg) applicable à ce client. Purement présentationnelle
 * (server component) : le calcul vient de lib/transportCost côté page.
 *
 *   • Export → 0 €/kg (le transport est payé par le client) ;
 *   • CHR / GMS / IDF → prix position au kilo (même calcul pour tous).
 *
 * Hebdomadaire / mensuel ne sont donnés qu'à titre indicatif dans les états
 * (page Coût de transport) — c'est bien l'ANNUEL qui est reporté ici.
 */
export function TransportCostCard({
  perKg,
  isExport,
  configured,
}: {
  /** Prix position €/kg applicable à ce client (0 si export). */
  perKg: number;
  /** Segment EXPORT (transport à la charge du client). */
  isExport: boolean;
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
          {isExport ? "0 €/kg" : configured ? fmtPerKg(perKg) : "—"}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">annuel</span>
      </div>

      {isExport ? (
        <p className="text-[12px] text-muted-foreground">
          Export : le transport est payé par le client — aucun coût imputé à la marge.
        </p>
      ) : configured ? (
        <p className="text-[12px] text-muted-foreground">
          Prix position appliqué à la marge nette transport (livraison IDF en propre).
          {" "}Déduit sur chaque vente : <span className="tnum font-medium text-foreground">{fmtPerKg(perKg)}</span> × kg livrés.
        </p>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Prix position non encore paramétré. À définir dans{" "}
          <Link href="/transport" className="text-brand-600 dark:text-brand-400 hover:underline">Coût de transport</Link>.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground/80">
        Valeur annuelle évolutive — mise à jour dans Pilotage ›{" "}
        <Link href="/transport" className="hover:underline">Coût de transport</Link>.
      </p>
    </div>
  );
}
