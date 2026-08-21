"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FullscreenPanel } from "@/components/ui/fullscreen-panel";
import { PurchaseOrderForm } from "./PurchaseOrderForm";
import { PurchaseOrderHistory } from "./PurchaseOrderHistory";

/**
 * /commandes-fournisseurs — la liste (dont « À réceptionner aujourd'hui ») est
 * la une ; la création passe derrière « Nouvelle commande » du PageHeader
 * (feuille plein écran). Après un succès, la feuille se ferme et l'historique
 * se rafraîchit.
 */
export function CommandesFournisseursWorkspace({ agreeurOnly }: { agreeurOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);

  return (
    <>
      <PageHeader
        kicker="SAP B1 · PurchaseOrder"
        title="Cde Fournisseur"
        help={
          <>
            Suivi des commandes d&apos;achat (engagements fournisseurs). Une commande arrivée
            à échéance de livraison est signalée <b>« à réceptionner »</b> ; sa validation crée
            l&apos;entrée marchandise correspondante et clôture la commande.
          </>
        }
        actions={
          agreeurOnly ? undefined : (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Nouvelle commande
            </Button>
          )
        }
      />

      <PurchaseOrderHistory restricted={agreeurOnly} reloadSignal={reload} />

      {!agreeurOnly && (
        <FullscreenPanel
          open={open}
          onOpenChange={setOpen}
          title="Nouvelle commande fournisseur"
          subtitle="Engagement d'achat — création côté SAP"
        >
          <div className="mx-auto max-w-5xl">
            <PurchaseOrderForm onCreated={() => { setOpen(false); setReload((n) => n + 1); }} />
          </div>
        </FullscreenPanel>
      )}
    </>
  );
}
