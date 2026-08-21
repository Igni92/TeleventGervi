"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FullscreenPanel } from "@/components/ui/fullscreen-panel";
import { GoodsReceiptForm } from "./GoodsReceiptForm";
import { GoodsReceiptHistory } from "./GoodsReceiptHistory";

/**
 * /entrees — UN flux : la liste des entrées est LA une. La création passe
 * derrière « Nouvelle entrée » (feuille plein écran). Après un succès, la
 * feuille se ferme et l'historique se rafraîchit.
 */
export function EntreesWorkspace({ agreeurOnly }: { agreeurOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);

  return (
    <>
      <PageHeader
        kicker="SAP B1 · PurchaseDeliveryNote"
        title="Entrée marchandise"
        help={
          agreeurOnly
            ? "Consultez ici les entrées marchandises. La réception d'une commande fournisseur se valide depuis l'écran « Commandes fournisseurs »."
            : (<>Saisis ici la réception physique d&apos;une marchandise — création directe du
              bon de réception côté SAP (DocNum généré), incrément immédiat du stock local
              et lot <b>EM&lt;DocNum&gt;</b> propagé aux prochaines commandes.</>)
        }
        actions={
          agreeurOnly ? undefined : (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Nouvelle entrée
            </Button>
          )
        }
      />

      <GoodsReceiptHistory restricted={agreeurOnly} reloadSignal={reload} />

      {!agreeurOnly && (
        <FullscreenPanel
          open={open}
          onOpenChange={setOpen}
          title="Nouvelle entrée marchandise"
          subtitle="Réception physique — création directe du bon de réception côté SAP"
        >
          <div className="mx-auto max-w-5xl">
            <GoodsReceiptForm onDone={() => { setOpen(false); setReload((n) => n + 1); }} />
          </div>
        </FullscreenPanel>
      )}
    </>
  );
}
