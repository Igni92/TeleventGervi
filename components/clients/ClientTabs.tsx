"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Briefcase, Receipt, Truck } from "lucide-react";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Onglets de la fiche client : Commercial / Comptabilité / Logistique.
 *
 * Léger (pas de Radix). State local + transition fade-up entre vues.
 * Les contenus sont passés en props : la page reste un Server Component
 * et délègue uniquement la bascule UI à ce composant client.
 */

type Tab = "commercial" | "compta" | "logistique";

interface ClientTabsProps {
  commercial: React.ReactNode;
  compta: React.ReactNode;
  logistique: React.ReactNode;
  defaultTab?: Tab;
}

export function ClientTabs({ commercial, compta, logistique, defaultTab = "commercial" }: ClientTabsProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const reduce = useReducedMotion();

  const panes: Record<Tab, React.ReactNode> = { commercial, compta, logistique };

  return (
    <div>
      <div role="tablist" aria-label="Sections fiche client" className="mb-5 inline-flex rounded-md border border-border bg-card/60 p-0.5">
        <TabButton active={tab === "commercial"} onClick={() => setTab("commercial")} icon={<Briefcase className="h-3.5 w-3.5" />}>
          Commercial
        </TabButton>
        <TabButton active={tab === "compta"} onClick={() => setTab("compta")} icon={<Receipt className="h-3.5 w-3.5" />}>
          Comptabilité
        </TabButton>
        <TabButton active={tab === "logistique"} onClick={() => setTab("logistique")} icon={<Truck className="h-3.5 w-3.5" />}>
          Logistique
        </TabButton>
      </div>
      <motion.div
        key={tab}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.base, ease: EASE.out }}
        role="tabpanel"
      >
        {panes[tab]}
      </motion.div>
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-8 px-3.5 text-[12.5px] font-medium rounded-[5px] transition-colors inline-flex items-center gap-1.5",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
