import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClientForm } from "@/components/ClientForm";
import { DeliveryModesEditor } from "@/components/clients/DeliveryModesEditor";
import { ContactsEditor } from "@/components/clients/ContactsEditor";
import { FamillesVsGroupe } from "@/components/clients/FamillesVsGroupe";
import { ComportementYoY } from "@/components/clients/ComportementYoY";
import { ProduitsRecurrents } from "@/components/clients/ProduitsRecurrents";
import { EncoursCreditCard } from "@/components/clients/EncoursCreditCard";
import { CompteForm } from "@/components/clients/CompteForm";
import { ClientTabs } from "@/components/clients/ClientTabs";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ArrowLeft, Calendar, Sprout, TrendingUp, Receipt, Repeat } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/utils";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { nom: true },
  });
  return {
    title: client ? `${client.nom} | TeleVent` : "Client | TeleVent",
  };
}

const statutVariant: Record<string, "planifie" | "fait" | "annule"> = {
  PLANIFIE: "planifie",
  FAIT: "fait",
  ANNULE: "annule",
};

const statutLabel: Record<string, string> = {
  PLANIFIE: "Planifié",
  FAIT: "Fait",
  ANNULE: "Annulé",
};

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) redirect("/login");

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      rappels: {
        orderBy: { dateRappel: "desc" },
        take: 20,
      },
    },
  });

  if (!client) notFound();

  const formData = {
    id: client.id,
    code: client.code,
    nom: client.nom,
    type: (client.type as "EXPORT" | "GMS" | "CHR") || undefined,
    commercial: client.commercial || "",
    tel1: client.tel1 || "",
    tel2: client.tel2 || "",
    tel3: client.tel3 || "",
    email: client.email || "",
    sapGroupCode: client.sapGroupCode,
    sapGroupName: client.sapGroupName,
    notes: client.notes || "",
    joursAppel: client.joursAppel
      ? client.joursAppel.split(",").map(Number).filter((n: number) => !isNaN(n))
      : [],
  };

  const commercialPane = (
    <div className="space-y-6">
      <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
        <h2 className="text-base font-semibold mb-5 text-slate-800 dark:text-foreground">Informations client</h2>
        <ClientForm initialData={formData} mode="edit" />
      </div>

      <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
        <ContactsEditor clientId={client.id} />
      </div>

      {/* C6 — Encours / limite de crédit (n'apparaît que si la donnée SAP existe). */}
      <EncoursCreditCard clientId={client.id} />

      <SurfaceCard
        accent="brand"
        title="Comportement N vs N-1 (YTD)"
        icon={<TrendingUp className="h-3.5 w-3.5" />}
      >
        <ComportementYoY clientId={client.id} />
      </SurfaceCard>

      {/* C7 — Top des produits que ce client commande le plus souvent. */}
      <SurfaceCard
        accent="violet"
        title="Produits récurrents"
        icon={<Repeat className="h-3.5 w-3.5" />}
      >
        <ProduitsRecurrents clientId={client.id} />
      </SurfaceCard>

      <SurfaceCard
        accent="emerald"
        title="Familles régulières · vs son groupe"
        icon={<Sprout className="h-3.5 w-3.5" />}
      >
        <FamillesVsGroupe clientId={client.id} />
      </SurfaceCard>

      <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
        <DeliveryModesEditor clientId={client.id} clientCode={client.code} />
      </div>

      {client.rappels.length > 0 && (
        <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-semibold text-slate-800 dark:text-foreground">
              Rappels ({client.rappels.length})
            </h2>
          </div>

          <div className="space-y-2">
            {client.rappels.map((rappel, i) => (
              <div key={rappel.id}>
                {i > 0 && <Separator className="my-2" />}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={statutVariant[rappel.statut] || "outline"}>
                        {statutLabel[rappel.statut] || rappel.statut}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(rappel.dateRappel)}
                      </span>
                    </div>
                    {rappel.note && (
                      <p className="text-sm text-slate-700 dark:text-slate-300">{rappel.note}</p>
                    )}
                  </div>
                  {rappel.msEventId && (
                    <span className="text-xs text-brand-500 dark:text-brand-400 shrink-0">📅 Calendrier</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const comptaPane = (
    <div className="space-y-6">
      <SurfaceCard
        accent="amber"
        title="Comptabilité"
        icon={<Receipt className="h-3.5 w-3.5" />}
      >
        <CompteForm clientId={client.id} />
      </SurfaceCard>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1 text-slate-500 dark:text-slate-400">
          <Link href="/clients">
            <ArrowLeft className="h-4 w-4" />
            Retour aux clients
          </Link>
        </Button>
      </div>

      <div>
        <p className="kicker mb-2">Fiche client · {client.type || "—"}</p>
        <h1 className="font-display text-[42px] font-light text-foreground leading-[0.95] tracking-tight">
          {client.nom}
        </h1>
        <p className="text-[12px] text-muted-foreground mt-3 font-mono">
          {client.code}
          {client.commercial && (
            <>
              <span className="opacity-40 mx-2">·</span>
              <span className="italic font-sans">suivi par {client.commercial}</span>
            </>
          )}
        </p>
      </div>

      <ClientTabs commercial={commercialPane} compta={comptaPane} />
    </div>
  );
}
