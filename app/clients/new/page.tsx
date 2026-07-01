import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClientForm } from "@/components/ClientForm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Nouveau client | Gervi",
};

export default async function NewClientPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1 text-slate-500 dark:text-slate-400">
          <Link href="/clients">
            <ArrowLeft className="h-4 w-4" />
            Retour aux clients
          </Link>
        </Button>
      </div>

      <div>
        <p className="kicker mb-2">Création</p>
        <h1 className="font-display text-[40px] font-light text-foreground leading-none tracking-tight">
          Nouveau <span className="italic text-foreground/50">client</span>
        </h1>
        <p className="text-[13px] text-muted-foreground mt-3 italic">
          Remplissez les champs pour l&apos;ajouter à la base.
        </p>
      </div>

      <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
        <ClientForm mode="create" />
      </div>
    </div>
  );
}
