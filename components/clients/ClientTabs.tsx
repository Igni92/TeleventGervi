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
      <div
        role="tablist"
        aria-label="Sections fiche client"
        className="sticky top-16 z-30 mb-5 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border glass p-1 shadow-sm md:top-2"
      >
        <TabButton active={tab === "commercial"} reduce={!!reduce} onClick={() => setTab("commercial")} icon={<Briefcase className="h-3.5 w-3.5" />}>
          Commercial
        </TabButton>
        <TabButton active={tab === "compta"} reduce={!!reduce} onClick={() => setTab("compta")} icon={<Receipt className="h-3.5 w-3.5" />}>
          Comptabilité
        </TabButton>
        <TabButton active={tab === "logistique"} reduce={!!reduce} onClick={() => setTab("logistique")} icon={<Truck className="h-3.5 w-3.5" />}>
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
  active, onClick, icon, children, reduce,
}: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode; reduce: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[12.5px] font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="ficheTabPill"
          className="absolute inset-0 rounded-lg border border-border bg-card shadow-sm after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-500 after:content-['']"
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
        />
      )}
      <span className="relative z-10 inline-flex items-center gap-1.5">
        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full transition-colors", active ? "bg-brand-500" : "bg-muted-foreground/40")} />
        {icon}
        {children}
      </span>
    </button>
  );
}
