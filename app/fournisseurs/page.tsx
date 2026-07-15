import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupplierTable } from "@/components/suppliers/SupplierTable";

export const metadata = { title: "Fournisseurs" };
export const dynamic = "force-dynamic";

export default async function FournisseursPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1.5">Achats</p>
          <h1 className="font-display text-[26px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
            Fournisseurs
          </h1>
          <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
            Le tiers d&apos;<b>achat</b> (marchandise entrante) — distinct du <b>client</b> de vente.
            Créez une fiche pour centraliser les <b>interlocuteurs</b> (commercial, qualité, compta),
            coordonnées et notes. Les achats restent gérés dans SAP.
          </p>
        </div>
        <Button asChild>
          <Link href="/fournisseurs/new">
            <Plus className="h-4 w-4" />
            Nouveau fournisseur
          </Link>
        </Button>
      </header>

      <SupplierTable />
    </div>
  );
}
