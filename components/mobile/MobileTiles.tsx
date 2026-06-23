"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Radio, ClipboardList, Users, Briefcase,
  PackagePlus, Package, Factory,
  Receipt, LayoutDashboard,
  Settings, Tag,
  type LucideIcon,
} from "lucide-react";

/**
 * Écran d'accueil MOBILE — un lanceur en tuiles « façon application », volontairement
 * différent du bureau. L'app est scindée en 4 axes métier :
 *
 *   • Commercial    — télévente au quotidien (console, plan d'appel, clients…)
 *   • Acheteur      — approvisionnement & stock (entrées marchandises, stock, fabrication)
 *   • Comptable     — encours & finances
 *   • Administrateur— pilotage & réglages
 *
 * (Pas de rôle technique en base : les axes sont une organisation de navigation,
 * pas un contrôle d'accès — tout reste accessible à tous.)
 */

type BadgeKey = "receptionIncidents";

interface Tile {
  href: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  badge?: BadgeKey;
}

interface Axis {
  key: "commercial" | "acheteur" | "comptable" | "admin";
  label: string;
  desc: string;
  tiles: Tile[];
}

const AXES: Axis[] = [
  {
    key: "commercial",
    label: "Commercial",
    desc: "Télévente au quotidien",
    tiles: [
      { href: "/console", label: "Console", sub: "Prise de commande", icon: Radio },
      { href: "/plan-appel", label: "Plan d'appel", sub: "Clients à appeler", icon: ClipboardList },
      { href: "/clients", label: "Clients", sub: "Fiches & recherche", icon: Users },
      { href: "/commerciaux", label: "Commerciaux", sub: "Portefeuilles", icon: Briefcase },
    ],
  },
  {
    key: "acheteur",
    label: "Acheteur",
    desc: "Approvisionnement & stock",
    tiles: [
      { href: "/entrees", label: "Entrées march.", sub: "Réceptions & incidents", icon: PackagePlus, badge: "receptionIncidents" },
      { href: "/products", label: "Stock", sub: "Disponibilités", icon: Package },
      { href: "/fabrication", label: "Fabrication", sub: "Assemblages", icon: Factory },
    ],
  },
  {
    key: "comptable",
    label: "Comptable",
    desc: "Encours & finances",
    tiles: [
      { href: "/encours", label: "Encours", sub: "Retards & relances", icon: Receipt },
      { href: "/dashboard", label: "Statistiques", sub: "Chiffres clés", icon: LayoutDashboard },
    ],
  },
  {
    key: "admin",
    label: "Administrateur",
    desc: "Pilotage & réglages",
    tiles: [
      { href: "/dashboard", label: "Cockpit", sub: "Vue d'ensemble", icon: LayoutDashboard },
      { href: "/promos", label: "Promotions", sub: "Offres en cours", icon: Tag },
      { href: "/parametres", label: "Paramètres", sub: "Configuration", icon: Settings },
    ],
  },
];

const ACCENT: Record<Axis["key"], { bar: string; chip: string; icon: string }> = {
  commercial: { bar: "bg-sky-500", chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400", icon: "from-sky-500/20 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  acheteur: { bar: "bg-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", icon: "from-amber-500/20 to-amber-500/5 text-amber-600 dark:text-amber-400" },
  comptable: { bar: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: "from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  admin: { bar: "bg-violet-500", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400", icon: "from-violet-500/20 to-violet-500/5 text-violet-600 dark:text-violet-400" },
};

/** Compteur d'incidents réception ouverts — pour la pastille de la tuile Entrées. */
function useReceptionBadge(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/entrees/incidents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.incidents) return;
        setN((j.incidents as { resolved: boolean }[]).filter((i) => !i.resolved).length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return n;
}

export function MobileTiles({ className }: { className?: string }) {
  const badges: Record<BadgeKey, number> = { receptionIncidents: useReceptionBadge() };

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      {AXES.map((axis) => {
        const accent = ACCENT[axis.key];
        return (
          <section key={axis.key}>
            <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
              <span className={`h-6 w-1.5 rounded-full ${accent.bar}`} aria-hidden />
              <h2 className="text-[17px] font-semibold text-foreground leading-none">{axis.label}</h2>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {axis.tiles.map((t) => {
                const Icon = t.icon;
                const count = t.badge ? badges[t.badge] ?? 0 : 0;
                return (
                  <Link
                    key={t.href + t.label}
                    href={t.href}
                    className="group relative flex flex-col justify-between h-[104px] rounded-2xl border border-border bg-card p-3.5 active:scale-[0.97] transition-transform overflow-hidden"
                  >
                    <div className="flex items-start justify-between">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${accent.icon}`}>
                        <Icon className="h-6 w-6" strokeWidth={1.9} />
                      </span>
                      {count > 0 && (
                        <span className="inline-flex min-w-[22px] h-[22px] px-1.5 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-[#0b1018]">
                          {count > 9 ? "9+" : count}
                        </span>
                      )}
                    </div>
                    <p className="text-[16px] font-semibold text-foreground leading-tight">{t.label}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
