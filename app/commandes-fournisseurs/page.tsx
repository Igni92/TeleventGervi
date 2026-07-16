import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { PurchaseOrderHistory } from "@/components/entrees/PurchaseOrderHistory";
import { PurchaseOrderForm } from "@/components/entrees/PurchaseOrderForm";
import { PreparateurNav } from "@/components/PreparateurNav";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Cde Fournisseur" };
export const dynamic = "force-dynamic";

export default async function CommandesFournisseursPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // L'AGRÉEUR « pur » (sans rôle de gestion) ne peut PAS créer de commande
  // fournisseur : on masque le formulaire de création. Il conserve l'historique
  // et l'action « Réceptionner → entrée marchandise » (son seul droit).
  const agreeurOnly = (await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session));
  return (
    // Mobile : plein écran app — les panneaux s'étalent d'eux-mêmes
    // (règle globale .surface-card, cf. globals.css).
    <div className="space-y-6 sm:space-y-8 animate-fade-up max-sm:space-y-3">
      {/* Nav terrain (mobile) : l'agréeur confiné navigue entre ses écrans. */}
      {isTerrainConfined(session) && <PreparateurNav current="commandes-fournisseurs" />}
      <PageHeader
        className="max-sm:hidden"
        kicker="SAP B1 · PurchaseOrder"
        title="Cde Fournisseur"
        help={
          <>
            Suivi des commandes d&apos;achat (engagements fournisseurs). Une commande arrivée
            à échéance de livraison est signalée <b>« à réceptionner »</b> ; sa validation crée
            l&apos;entrée marchandise correspondante et clôture la commande.
          </>
        }
      />
      {!agreeurOnly && <PurchaseOrderForm />}
      <PurchaseOrderHistory restricted={agreeurOnly} />
    </div>
  );
}
