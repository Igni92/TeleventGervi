"use client";

import { CreditCard } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EncoursCredit, useCredit } from "@/components/clients/EncoursCredit";

/**
 * Wrapper client de l'encart « Encours / limite de crédit » (C6).
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
    <SurfaceCard
      accent="rose"
      title="Encours / limite de crédit"
      icon={<CreditCard className="h-3.5 w-3.5" />}
    >
      <EncoursCredit data={data} />
    </SurfaceCard>
  );
}
