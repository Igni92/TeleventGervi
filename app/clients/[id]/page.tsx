import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClientForm } from "@/components/ClientForm";
import { DeliveryModesEditor } from "@/components/clients/DeliveryModesEditor";
import { ContactsEditor } from "@/components/clients/ContactsEditor";
import { FamillesVsGroupe } from "@/components/clients/FamillesVsGroupe";
import { ComportementYoY } from "@/components/clients/ComportementYoY";
import { CompteForm } from "@/components/clients/CompteForm";
import { ReceptionEmailForm } from "@/components/clients/ReceptionEmailForm";
import { BillingAddressForm } from "@/components/clients/BillingAddressForm";
import { ReorderableSections } from "@/components/clients/ReorderableSections";
import { ProduitsRecurrents } from "@/components/clients/ProduitsRecurrents";
import { EncoursCreditCard } from "@/components/clients/EncoursCreditCard";
import { RgpdExportButton } from "@/components/clients/RgpdExportButton";
import { ClientTabs } from "@/components/clients/ClientTabs";
import { FicheActions } from "@/components/clients/FicheActions";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ArrowLeft, Calendar, Sprout, TrendingUp, Receipt, Truck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/utils";
import { requireAdmin } from "@/lib/permissions";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

export default async function ClientDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) redirect("/login");
  const admin = await requireAdmin(session);

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
    // Défaut lundi→samedi quand non renseigné (demande métier).
    joursLivraison: client.joursLivraison
      ? client.joursLivraison.split(",").map(Number).filter((n: number) => !isNaN(n))
      : [1, 2, 3, 4, 5, 6],
  };

  const commercialPane = (
    <ReorderableSections
      storageKey="fiche:commercial"
      sections={[
        { id: "actions", label: "Actions commerciales", wide: true, node: (
          <FicheActions clientId={client.id} clientName={client.nom} />
        ) },
        { id: "infos", label: "Informations client", wide: true, node: (
          <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-4 sm:p-6">
            <h2 className="text-base font-semibold mb-5 text-slate-800 dark:text-foreground">Informations client</h2>
            <ClientForm initialData={formData} mode="edit" />
          </div>
        ) },
        { id: "contacts", label: "Interlocuteurs", node: (
          <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
            <ContactsEditor clientId={client.id} />
          </div>
        ) },
        { id: "comportement", label: "Comportement N vs N-1 (YTD)", node: (
          <SurfaceCard accent="brand" title="Comportement N vs N-1 (YTD)" icon={<TrendingUp className="h-3.5 w-3.5" />}>
            <ComportementYoY clientId={client.id} />
          </SurfaceCard>
        ) },
        { id: "familles", label: "Familles régulières", node: (
          <SurfaceCard accent="emerald" title="Familles régulières · vs son groupe" icon={<Sprout className="h-3.5 w-3.5" />}>
            <FamillesVsGroupe clientId={client.id} />
          </SurfaceCard>
        ) },
        { id: "produits", label: "Produits récurrents", wide: true, node: (
          <ProduitsRecurrents clientId={client.id} />
        ) },
        ...(client.rappels.length > 0 ? [{ id: "rappels", label: `Rappels (${client.rappels.length})`, node: (
          <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              <h2 className="text-base font-semibold text-slate-800 dark:text-foreground">Rappels ({client.rappels.length})</h2>
            </div>
            <div className="space-y-2">
              {client.rappels.map((rappel, i) => (
                <div key={rappel.id}>
                  {i > 0 && <Separator className="my-2" />}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={statutVariant[rappel.statut] || "outline"}>{statutLabel[rappel.statut] || rappel.statut}</Badge>
                        <span className="text-sm text-muted-foreground">{formatDate(rappel.dateRappel)}</span>
                      </div>
                      {rappel.note && <p className="text-sm text-slate-700 dark:text-slate-300">{rappel.note}</p>}
                    </div>
                    {rappel.msEventId && <span className="text-xs text-brand-500 dark:text-brand-400 shrink-0">📅 Calendrier</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) }] : []),
      ]}
    />
  );

  const comptaPane = (
    <ReorderableSections
      storageKey="fiche:compta"
      sections={[
        { id: "encours", label: "Encours / crédit", wide: true, node: <EncoursCreditCard clientId={client.id} /> },
        { id: "compta", label: "Comptabilité", node: (
          <SurfaceCard accent="amber" title="Comptabilité" icon={<Receipt className="h-3.5 w-3.5" />}>
            <CompteForm clientId={client.id} />
          </SurfaceCard>
        ) },
        { id: "adresse", label: "Adresse de facturation", node: (
          <SurfaceCard accent="sky" title="Adresse de facturation" icon={<Receipt className="h-3.5 w-3.5" />}>
            <BillingAddressForm clientId={client.id} />
          </SurfaceCard>
        ) },
      ]}
    />
  );

  const logistiquePane = (
    <ReorderableSections
      storageKey="fiche:logistique"
      sections={[
        { id: "reception", label: "Réception marchandise", node: (
          <SurfaceCard accent="sky" title="Réception marchandise" icon={<Truck className="h-3.5 w-3.5" />}>
            <ReceptionEmailForm clientId={client.id} />
          </SurfaceCard>
        ) },
        { id: "modes", label: "Modes de livraison", wide: true, node: (
          <div className="bg-white dark:bg-card rounded-xl border border-border shadow-card p-6">
            <DeliveryModesEditor clientId={client.id} clientCode={client.code} />
          </div>
        ) },
      ]}
    />
  );

  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1600px] overflow-x-hidden">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1 text-slate-500 dark:text-slate-400">
          <Link href="/clients">
            <ArrowLeft className="h-4 w-4" />
            Retour aux clients
          </Link>
        </Button>
        {admin && <RgpdExportButton clientId={client.id} />}
      </div>

      <div>
        <p className="kicker mb-2">Fiche client · {client.type || "—"}</p>
        <h1 className="font-display text-[30px] sm:text-[42px] font-light text-foreground leading-[1.02] sm:leading-[0.95] tracking-tight break-words">
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

      <ClientTabs commercial={commercialPane} compta={comptaPane} logistique={logistiquePane} />
    </div>
  );
}
