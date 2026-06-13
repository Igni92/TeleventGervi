"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight, BadgePercent, Briefcase, ClipboardList, Factory,
  LayoutDashboard, LayoutGrid, PackagePlus, Radio, Receipt, Settings, Users,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { staggerContainer, staggerItem, reducedFade } from "@/lib/motion";

/**
 * Grille « Modules » — accès direct aux espaces de travail depuis l'accueil.
 * Tuiles iconées, description d'un mot, hover signal (bord brand + flèche).
 */

interface ModuleDef {
  href: string;
  label: string;
  /** description d'un mot */
  desc: string;
  icon: typeof Radio;
  /** pastille icône (fond translucide + texte) */
  tone: string;
  /** halo au survol */
  glow: string;
}

const MODULES: ModuleDef[] = [
  { href: "/console",     label: "Console",      desc: "Commandes",    icon: Radio,           tone: "bg-brand-500/10 text-brand-400",     glow: "group-hover:shadow-[0_0_16px_rgba(99,102,241,0.35)]" },
  { href: "/plan-appel",  label: "Plan d'appel", desc: "Tournées",     icon: ClipboardList,   tone: "bg-sky-500/10 text-sky-400",         glow: "group-hover:shadow-[0_0_16px_rgba(14,165,233,0.3)]" },
  { href: "/clients",     label: "Clients",      desc: "Portefeuille", icon: Users,           tone: "bg-emerald-500/10 text-emerald-400", glow: "group-hover:shadow-[0_0_16px_rgba(16,185,129,0.3)]" },
  { href: "/entrees",     label: "Entrées",      desc: "Réceptions",   icon: PackagePlus,     tone: "bg-amber-500/10 text-amber-400",     glow: "group-hover:shadow-[0_0_16px_rgba(245,158,11,0.3)]" },
  { href: "/fabrication", label: "Fabrication",  desc: "Ateliers",     icon: Factory,         tone: "bg-violet-500/10 text-violet-400",   glow: "group-hover:shadow-[0_0_16px_rgba(139,92,246,0.3)]" },
  { href: "/encours",     label: "Encours",      desc: "Règlements",   icon: Receipt,         tone: "bg-rose-500/10 text-rose-400",       glow: "group-hover:shadow-[0_0_16px_rgba(244,63,94,0.3)]" },
  { href: "/dashboard",   label: "Stats",        desc: "Pilotage",     icon: LayoutDashboard, tone: "bg-brand-500/10 text-brand-400",     glow: "group-hover:shadow-[0_0_16px_rgba(99,102,241,0.35)]" },
  { href: "/promos",      label: "Promos",       desc: "Animations",   icon: BadgePercent,    tone: "bg-amber-500/10 text-amber-400",     glow: "group-hover:shadow-[0_0_16px_rgba(245,158,11,0.3)]" },
  { href: "/commerciaux", label: "Commerciaux",  desc: "Équipe",       icon: Briefcase,       tone: "bg-emerald-500/10 text-emerald-400", glow: "group-hover:shadow-[0_0_16px_rgba(16,185,129,0.3)]" },
  { href: "/parametres",  label: "Paramètres",   desc: "Réglages",     icon: Settings,        tone: "bg-slate-500/10 text-slate-400",     glow: "group-hover:shadow-[0_0_16px_rgba(100,116,139,0.3)]" },
];

export function ModuleGrid() {
  const reduce = useReducedMotion();
  return (
    <SurfaceCard
      title="Modules"
      icon={<LayoutGrid className="h-3.5 w-3.5" />}
      delay={80}
    >
      <motion.ul
        variants={staggerContainer(0.025)}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2"
      >
        {MODULES.map(({ href, label, desc, icon: Icon, tone, glow }) => (
          <motion.li key={href} variants={reduce ? reducedFade : staggerItem}>
            <Link
              href={href}
              className="group relative flex flex-col gap-2 rounded-lg border border-border/70 bg-secondary/25 px-3 py-3 transition-all duration-150 hover:border-brand-500/45 hover:bg-secondary/55 hover:-translate-y-0.5"
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg transition-shadow duration-200 ${tone} ${glow}`}>
                <Icon className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-foreground leading-tight truncate">
                  {label}
                </span>
                <span className="block text-[10.5px] text-muted-foreground mt-0.5 truncate">
                  {desc}
                </span>
              </span>
              <ArrowUpRight
                className="absolute top-2.5 right-2.5 h-3.5 w-3.5 text-transparent group-hover:text-brand-400 transition-colors duration-150"
                aria-hidden
              />
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </SurfaceCard>
  );
}
