import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { GoodsReceiptForm } from "@/components/entrees/GoodsReceiptForm";
import { GoodsReceiptHistory } from "@/components/entrees/GoodsReceiptHistory";
import { PreparateurNav } from "@/components/PreparateurNav";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Entrée marchandise" };
export const dynamic = "force-dynamic";

export default async function EntreesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // L'AGRÉEUR « pur » (sans rôle de gestion) ne peut PAS créer d'entrée marchandise :
  // on masque le formulaire de saisie et on ne lui laisse que l'historique. La
  // création reste possible pour la préparation / l'administration.
  // NB : l'AGRÉAGE ne se fait qu'au moment de la réception d'une COMMANDE
  // FOURNISSEUR (écran Commandes fournisseurs) — ici, il est seulement AFFICHÉ.
  const agreeurOnly = (await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session));
  return (
    // Mobile : plein écran app — les panneaux s'étalent d'eux-mêmes
    // (règle globale .surface-card, cf. globals.css) ; titre porté par la
    // barre du haut.
    <div className="space-y-6 sm:space-y-8 animate-fade-up max-sm:space-y-3">
      {/* Nav terrain (mobile) : l'agréeur confiné navigue entre ses écrans. */}
      {isTerrainConfined(session) && <PreparateurNav current="entrees" />}
      <PageHeader
        className="max-sm:hidden"
        kicker="SAP B1 · PurchaseDeliveryNote"
        title="Entrée marchandise"
        help={
          agreeurOnly
            ? "Consultez ici les entrées marchandises. La réception d'une commande fournisseur se valide depuis l'écran « Commandes fournisseurs »."
            : (<>Saisis ici la réception physique d&apos;une marchandise — création directe du
              bon de réception côté SAP (DocNum généré), incrément immédiat du stock local
              et lot <b>EM&lt;DocNum&gt;</b> propagé aux prochaines commandes.</>)
        }
      />
      {!agreeurOnly && <GoodsReceiptForm />}
      <GoodsReceiptHistory restricted={agreeurOnly} />
    </div>
  );
}
