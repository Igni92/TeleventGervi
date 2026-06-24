"use client";

import { CreditCard } from "lucide-react";
import { SectionCard } from "@/components/clients/SectionCard";
import { EncoursCredit, useCredit } from "@/components/clients/EncoursCredit";

/**
 * Wrapper de l'encart « Encours / limite de crédit » de la fiche client.
 *
 * Monte le SurfaceCard UNIQUEMENT si la donnée crédit est disponible
 * (available=true côté API). Tant que la migration des colonnes
 * SapBusinessPartner n'est pas appliquée — ou si le BP n'est pas mirroré —
 * l'encart ne s'affiche pas (pas d'espace réservé, pas de bruit).
 */
export function EncoursCreditCard({ clientId }: { clientId: string }) {
  const { data } = useCredit(clientId);

  if (!data || !("available" in data) || !data.available) return null;

  return (
    <SectionCard
      accent="rose"
      title="Encours / limite de crédit"
      subtitle="Miroir SAP · lecture seule"
      icon={<CreditCard />}
    >
      <EncoursCredit data={data} />
    </SectionCard>
  );
}
