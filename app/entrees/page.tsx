import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { GoodsReceiptForm } from "@/components/entrees/GoodsReceiptForm";
import { GoodsReceiptHistory } from "@/components/entrees/GoodsReceiptHistory";

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
    <div className="space-y-6 sm:space-y-8 animate-fade-up">
      <div>
        <p className="kicker mb-2 hidden md:block">SAP B1 · PurchaseDeliveryNote</p>
        <h1 className="text-[26px] sm:text-[32px] font-bold text-foreground tracking-tight leading-none">
          Entrée marchandise
        </h1>
        {/* Intro détaillée réservée au bureau — sur mobile on va à l'essentiel. */}
        <p className="hidden md:block text-[13px] text-muted-foreground mt-3 max-w-2xl">
          {agreeurOnly
            ? "Consultez ici les entrées marchandises. La réception d'une commande fournisseur se valide depuis l'écran « Commandes fournisseurs »."
            : (<>Saisis ici la réception physique d&apos;une marchandise — création directe du
              bon de réception côté SAP (DocNum généré), incrément immédiat du stock local
              et lot <b>EM&lt;DocNum&gt;</b> propagé aux prochaines commandes.</>)}
        </p>
      </div>
      {!agreeurOnly && <GoodsReceiptForm />}
      <GoodsReceiptHistory />
    </div>
  );
}
