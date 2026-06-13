import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { GoodsReceiptForm } from "@/components/entrees/GoodsReceiptForm";
import { GoodsReceiptHistory } from "@/components/entrees/GoodsReceiptHistory";

export const metadata = { title: "Entrée marchandise" };
export const dynamic = "force-dynamic";

export default async function EntreesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-8 animate-fade-up">
      <div>
        <p className="kicker mb-2">SAP B1 · PurchaseDeliveryNote</p>
        <h1 className="text-[32px] font-bold text-foreground tracking-tight leading-none">
          Entrée marchandise
        </h1>
        <p className="text-[13px] text-muted-foreground mt-3 max-w-2xl">
          Saisis ici la réception physique d&apos;une marchandise — création directe du
          bon de réception côté SAP (DocNum généré), incrément immédiat du stock local
          et lot <b>EM&lt;DocNum&gt;</b> propagé aux prochaines commandes.
        </p>
      </div>
      <GoodsReceiptForm />
      <GoodsReceiptHistory />
    </div>
  );
}
