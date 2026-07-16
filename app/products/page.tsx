import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductsTable } from "@/components/products/ProductsTable";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Stock SAP" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-up">
      <PageHeader
        kicker="Stock SAP B1"
        title={<>Produits &amp; stock</>}
        help={
          <>
            Stock par entrepôt synchronisé depuis SAP B1 — entrepôts <b>000</b> (A/C-A/D), <b>01</b> (Stock physique), <b>R1</b> (J+1).
            Le sync s&apos;exécute automatiquement toutes les 5 minutes en arrière-plan.
          </>
        }
      />
      <ProductsTable />
    </div>
  );
}
