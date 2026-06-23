"use client";

import { useState } from "react";
import { ClipboardList, PackageCheck } from "lucide-react";
import { GoodsReceiptHistory } from "./GoodsReceiptHistory";
import { PurchaseOrderHistory } from "./PurchaseOrderHistory";

/**
 * Bascule entre les deux historiques liés aux achats :
 *   - « Entrées marchandises » (PurchaseDeliveryNotes) — réceptions physiques.
 *   - « Commandes fournisseurs » (PurchaseOrders) — engagements d'achat amont.
 * Deux onglets côte à côte, lisibles sur mobile (cibles 44px, pleine largeur).
 */
export function EntreesHistoryTabs() {
  const [tab, setTab] = useState<"receipts" | "orders">("receipts");

  return (
    <div className="space-y-4">
      <div className="inline-flex w-full sm:w-auto rounded-xl border border-border bg-secondary/40 p-1">
        <button
          type="button"
          onClick={() => setTab("receipts")}
          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-[13px] font-semibold transition-colors ${
            tab === "receipts" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Entrées marchandises
        </button>
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-[13px] font-semibold transition-colors ${
            tab === "orders" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <PackageCheck className="h-4 w-4" />
          Commandes fournisseurs
        </button>
      </div>

      {tab === "receipts" ? <GoodsReceiptHistory /> : <PurchaseOrderHistory />}
    </div>
  );
}
