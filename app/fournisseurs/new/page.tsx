import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SupplierForm } from "@/components/suppliers/SupplierForm";

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

      <div>
        <p className="kicker mb-2">Création</p>
        <h1 className="font-display text-[28px] sm:text-[36px] lg:text-[40px] font-light text-foreground leading-none tracking-tight">
          Nouveau <span className="italic text-foreground/50">fournisseur</span>
        </h1>
        <p className="text-[13px] text-muted-foreground mt-3 italic">
          Rattachez un tiers SAP ou saisissez la fiche à la main, puis ajoutez ses interlocuteurs.
        </p>
      </div>

      <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
        <SupplierForm mode="create" />
      </div>
    </div>
  );
}
