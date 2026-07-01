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
import { DeliveryAddressForm } from "@/components/clients/DeliveryAddressForm";
import { DeliveryDaysEditor } from "@/components/clients/DeliveryDaysEditor";
import { ReorderableSections } from "@/components/clients/ReorderableSections";
import { ProduitsRecurrents } from "@/components/clients/ProduitsRecurrents";
import { EncoursCreditCard } from "@/components/clients/EncoursCreditCard";
import { ClientTabs } from "@/components/clients/ClientTabs";
import { FicheActions } from "@/components/clients/FicheActions";
import { FicheHeader } from "@/components/clients/FicheHeader";
import { SectionCard } from "@/components/clients/SectionCard";
import { Calendar, CalendarClock, CalendarDays, Sprout, TrendingUp, Receipt, Truck, UserRound, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { requireAdmin } from "@/lib/permissions";
import { computeInsights } from "@/lib/insights";
import { computePriority } from "@/lib/priority";
import { caByClientCode } from "@/lib/clientRevenue";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { nom: true },
  });
  return {
    title: client ? `${client.nom} | Gervi` : "Client | Gervi",
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

const statutDot: Record<string, string> = {
  PLANIFIE: "bg-amber-500",
  FAIT: "bg-emerald-500",
  ANNULE: "bg-slate-400",
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

  // ── Cycle de vie + valeur client (CRM #5/#17) — dérivés À LA LECTURE, rien
  // n'est stocké. Signaux : historique d'appels (cadence/récence, lib/insights)
  // + CA 12 mois glissants (palier de valeur, lib/clientRevenue). Best-effort :
  // si le CA échoue, le palier retombe sur D et le badge reste pertinent.
  const last180 = new Date();
  last180.setDate(last180.getDate() - 180);
  const [appels, caMap] = await Promise.all([
    prisma.appelLog.findMany({
      where: { clientId: client.id, heureAppel: { gte: last180 } },
      select: { type: true, heureAppel: true },
      orderBy: { heureAppel: "desc" },
    }),
    caByClientCode([client.code]).catch(() => new Map<string, number>()),
  ]);
  const insights = computeInsights(appels);
  const ca12m = caMap.get(client.code) ?? 0;
  const { lifecycle, tier } = computePriority({
    lastOrderDays: insights.lastOrderDays,
    medianIntervalDays: insights.medianIntervalDays,
    trend30: insights.trend30,
    ca12m,
  });

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
    // Les jours de LIVRAISON sont édités dans l'onglet Logistique (DeliveryDaysEditor).
  };

  const commercialPane = (
    <ReorderableSections
      storageKey="fiche:commercial"
      sections={[
        { id: "actions", label: "Actions commerciales", wide: true, node: (
          <FicheActions clientId={client.id} clientName={client.nom} />
        ) },
        { id: "infos", label: "Informations client", wide: true, node: (
          <SectionCard
            accent="brand"
            title="Informations client"
            subtitle="Coordonnées · rattachement · préférences d'appel"
            icon={<UserRound />}
          >
            <ClientForm initialData={formData} mode="edit" />
          </SectionCard>
        ) },
        { id: "contacts", label: "Interlocuteurs", node: (
          <SectionCard bare>
            <ContactsEditor clientId={client.id} />
          </SectionCard>
        ) },
        { id: "comportement", label: "Comportement N vs N-1 (YTD)", node: (
          <SectionCard accent="brand" title="Comportement N vs N-1" subtitle="Année en cours vs même période N-1 (YTD)" icon={<TrendingUp />}>
            <ComportementYoY clientId={client.id} />
          </SectionCard>
        ) },
        { id: "familles", label: "Familles régulières", node: (
          <SectionCard accent="emerald" title="Familles régulières" subtitle="Volume vs médiane de son groupe SAP" icon={<Sprout />}>
            <FamillesVsGroupe clientId={client.id} />
          </SectionCard>
        ) },
        { id: "produits", label: "Produits récurrents", wide: true, node: (
          <ProduitsRecurrents clientId={client.id} />
        ) },
        ...(client.rappels.length > 0 ? [{ id: "rappels", label: `Rappels (${client.rappels.length})`, node: (
          <SectionCard
            accent="violet"
            title="Rappels"
            subtitle={`${client.rappels.length} enregistré${client.rappels.length > 1 ? "s" : ""}`}
            icon={<Calendar />}
          >
            <ul className="space-y-2">
              {client.rappels.map((rappel) => (
                <li
                  key={rappel.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-2.5"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statutDot[rappel.statut] || "bg-slate-400"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statutVariant[rappel.statut] || "outline"}>{statutLabel[rappel.statut] || rappel.statut}</Badge>
                      <span className="text-[12px] text-muted-foreground tabular-nums">{formatDate(rappel.dateRappel)}</span>
                      {rappel.msEventId && (
                        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 dark:text-brand-400">
                          <CalendarClock className="h-3 w-3" /> Agenda
                        </span>
                      )}
                    </div>
                    {rappel.note && <p className="mt-1 text-[13px] leading-snug text-foreground/80">{rappel.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
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
          <SectionCard accent="amber" title="Comptabilité" subtitle="Email de facturation & relances" icon={<Receipt />}>
            <CompteForm clientId={client.id} />
          </SectionCard>
        ) },
        { id: "adresse", label: "Adresse de facturation", node: (
          <SectionCard accent="sky" title="Adresse de facturation" subtitle="Synchronisée avec SAP (« Facturer à »)" icon={<MapPin />}>
            <BillingAddressForm clientId={client.id} />
          </SectionCard>
        ) },
      ]}
    />
  );

  const logistiquePane = (
    <ReorderableSections
      storageKey="fiche:logistique"
      sections={[
        { id: "jours-livraison", label: "Jours de livraison", node: (
          <SectionCard accent="emerald" title="Jours de livraison" subtitle="Décochez tout si le client n'est pas livré" icon={<CalendarDays />}>
            <DeliveryDaysEditor clientId={client.id} />
          </SectionCard>
        ) },
        { id: "reception", label: "Réception marchandise", node: (
          <SectionCard accent="sky" title="Réception marchandise" subtitle="Email quai & litiges réception" icon={<Truck />}>
            <ReceptionEmailForm clientId={client.id} />
          </SectionCard>
        ) },
        { id: "adresse-livraison", label: "Adresse de livraison", node: (
          <SectionCard accent="emerald" title="Adresse de livraison" subtitle="Synchronisée avec SAP (« Livrer à » · bo_ShipTo)" icon={<MapPin />}>
            <DeliveryAddressForm clientId={client.id} />
          </SectionCard>
        ) },
        { id: "modes", label: "Modes de livraison", wide: true, node: (
          <SectionCard bare>
            <DeliveryModesEditor clientId={client.id} clientCode={client.code} />
          </SectionCard>
        ) },
      ]}
    />
  );

  return (
    <div className="max-w-[1600px] space-y-5 overflow-x-clip">
      <FicheHeader
        clientId={client.id}
        name={client.nom}
        code={client.code}
        type={client.type}
        commercial={client.commercial}
        admin={admin}
        lifecycle={lifecycle}
        tier={tier}
      />

      <ClientTabs commercial={commercialPane} compta={comptaPane} logistique={logistiquePane} />
    </div>
  );
}
