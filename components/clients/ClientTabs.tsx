"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Onglets Commercial / Comptabilité pour la fiche client (B6).
 *
 * Léger (pas de Radix). State local + transition fade-up entre vues.
 * Les contenus sont passés en props : la page reste un Server Component
 * et délègue uniquement la bascule UI à ce composant client.
 */

type Tab = "commercial" | "compta";

interface ClientTabsProps {
  commercial: React.ReactNode;
  compta: React.ReactNode;
  defaultTab?: Tab;
}

export function ClientTabs({ commercial, compta, defaultTab = "commercial" }: ClientTabsProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const reduce = useReducedMotion();

  return (
    <div>
      <div role="tablist" aria-label="Sections fiche client" className="mb-5 inline-flex rounded-md border border-border bg-card/60 p-0.5">
        <TabButton active={tab === "commercial"} onClick={() => setTab("commercial")}>
          Commercial
        </TabButton>
        <TabButton active={tab === "compta"} onClick={() => setTab("compta")}>
          Comptabilité
        </TabButton>
      </div>
      <motion.div
        key={tab}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.base, ease: EASE.out }}
        role="tabpanel"
      >
        {tab === "commercial" ? commercial : compta}
      </motion.div>
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-8 px-4 text-[12.5px] font-medium rounded-[5px] transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
