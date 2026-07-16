import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupplierTable } from "@/components/suppliers/SupplierTable";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Fournisseurs" };
export const dynamic = "force-dynamic";

export default async function FournisseursPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-up">
      <PageHeader
        kicker="Achats"
        title="Fournisseurs"
        help={
          <>
            Le tiers d&apos;<b>achat</b> (marchandise entrante) — distinct du <b>client</b> de vente.
            Créez une fiche pour centraliser les <b>interlocuteurs</b> (commercial, qualité, compta),
            coordonnées et notes. Les achats restent gérés dans SAP.
          </>
        }
        actions={
          <Button asChild>
            <Link href="/fournisseurs/new">
              <Plus className="h-4 w-4" />
              Nouveau fournisseur
            </Link>
          </Button>
        }
      />

      <SupplierTable />
    </div>
  );
}
