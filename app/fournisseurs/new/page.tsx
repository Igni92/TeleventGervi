import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = {
  title: "Nouveau fournisseur | Gervi",
};

export default async function NewSupplierPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1 text-slate-500 dark:text-slate-400">
          <Link href="/fournisseurs">
            <ArrowLeft className="h-4 w-4" />
            Retour aux fournisseurs
          </Link>
        </Button>
      </div>

      <PageHeader
        kicker="Création"
        title={<>Nouveau <span className="italic text-foreground/50">fournisseur</span></>}
        help={<>Rattachez un tiers SAP ou saisissez la fiche à la main, puis ajoutez ses interlocuteurs.</>}
      />

      <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
        <SupplierForm mode="create" />
      </div>
    </div>
  );
}
