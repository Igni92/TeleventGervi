import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductsTable } from "@/components/products/ProductsTable";

export const metadata = { title: "Stock SAP" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="kicker mb-2">Stock SAP B1</p>
        <h1 className="text-[32px] font-bold text-foreground tracking-tight leading-none">
          Produits & stock
        </h1>
        <p className="text-[13px] text-muted-foreground mt-3 max-w-2xl">
          Stock par entrepôt synchronisé depuis SAP B1 — entrepôts <b>000</b> (A/C-A/D), <b>01</b> (Stock physique), <b>R1</b> (J+1).
          Le sync s&apos;exécute automatiquement toutes les 5 minutes en arrière-plan.
        </p>
      </div>
      <ProductsTable />
    </div>
  );
}
