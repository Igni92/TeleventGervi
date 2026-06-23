import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PurchaseOrderHistory } from "@/components/entrees/PurchaseOrderHistory";

export const metadata = { title: "Commandes fournisseurs" };
export const dynamic = "force-dynamic";

export default async function CommandesFournisseursPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-up">
      <div>
        <p className="kicker mb-2 hidden md:block">SAP B1 · PurchaseOrder</p>
        <h1 className="text-[26px] sm:text-[32px] font-bold text-foreground tracking-tight leading-none">
          Commandes fournisseurs
        </h1>
        <p className="hidden md:block text-[13px] text-muted-foreground mt-3 max-w-2xl">
          Suivi des commandes d&apos;achat (engagements fournisseurs). Une commande arrivée
          à échéance de livraison est signalée <b>« à réceptionner »</b> ; sa validation crée
          l&apos;entrée marchandise correspondante et clôture la commande.
        </p>
      </div>
      <PurchaseOrderHistory />
    </div>
  );
}
