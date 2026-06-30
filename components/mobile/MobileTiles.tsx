"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Users, Briefcase, Truck,
  PackagePlus, PackageCheck, Package, Factory, ClipboardCheck,
  Receipt, LayoutDashboard,
  Settings, Tag,
  type LucideIcon,
} from "lucide-react";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { navAllowedForPreview } from "@/lib/rolePreview";

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

type BadgeKey = "receptionIncidents" | "commandesDue" | "inventairePending";

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
    desc: "Clients & commandes",
    // Pas d'outils de télévente (console / plan d'appel) sur mobile : tout passe
    // par la fiche client (commander, noter, notifier un appel). Le « Détail
    // livraison » fait exception : utile en mobilité pour préparer la tournée.
    tiles: [
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/livraisons", label: "Détail livraison", icon: Truck },
    ],
  },
  {
    key: "acheteur",
    label: "Acheteur",
    desc: "Approvisionnement & stock",
    tiles: [
      { href: "/entrees", label: "Entrées march.", icon: PackagePlus, badge: "receptionIncidents" },
      { href: "/commandes-fournisseurs", label: "Cmd. fourn.", icon: PackageCheck, badge: "commandesDue" },
      { href: "/inventaire", label: "Inventaire", icon: ClipboardCheck, badge: "inventairePending" },
      { href: "/products", label: "Stock", icon: Package },
      { href: "/fabrication", label: "Fabrication", icon: Factory },
    ],
  },
  {
    key: "comptable",
    label: "Comptable",
    desc: "Encours & finances",
    tiles: [
      { href: "/encours", label: "Encours", icon: Receipt },
      { href: "/dashboard", label: "Statistiques", icon: LayoutDashboard },
    ],
  },
  {
    key: "admin",
    label: "Administrateur",
    desc: "Pilotage & réglages",
    tiles: [
      { href: "/commerciaux", label: "Effectifs", icon: Briefcase },
      { href: "/promos", label: "Promotions", icon: Tag },
      { href: "/parametres", label: "Paramètres", icon: Settings },
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

/** Commandes fournisseurs à réceptionner (échéance atteinte) — pastille tuile. */
function useCommandesDueBadge(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sap/purchase-orders/due-count", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && typeof j?.count === "number") setN(j.count); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return n;
}

/** Inventaires soumis non revus — pastille tuile inventaire (admins / préparateurs). */
function useInventaireBadge(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/inventaire", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && typeof j?.pendingReview === "number") setN(j.pendingReview); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return n;
}

export function MobileTiles({ className }: { className?: string }) {
  const { previewRole } = useRolePreview();
  const badges: Record<BadgeKey, number> = {
    receptionIncidents: useReceptionBadge(),
    commandesDue: useCommandesDueBadge(),
    inventairePending: useInventaireBadge(),
  };

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      {AXES.map((axis) => {
        // Aperçu « voir comme » : ne montrer que les tuiles du périmètre du rôle.
        const tiles = axis.tiles.filter((t) => navAllowedForPreview(t.href, previewRole));
        if (tiles.length === 0) return null;
        const accent = ACCENT[axis.key];
        return (
          <section key={axis.key}>
            <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
              <span className={`h-6 w-1.5 rounded-full ${accent.bar}`} aria-hidden />
              <h2 className="text-[17px] font-semibold text-foreground leading-none">{axis.label}</h2>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {tiles.map((t, idx) => {
                const Icon = t.icon;
                const count = t.badge ? badges[t.badge] ?? 0 : 0;
                // Dernière tuile d'un axe au nombre impair → pleine largeur (pas de trou).
                const fillRow = idx === tiles.length - 1 && tiles.length % 2 === 1;
                return (
                  <Link
                    key={t.href + t.label}
                    href={t.href}
                    className={`group relative flex flex-col justify-between h-[104px] rounded-2xl border border-border bg-card p-3.5 active:scale-[0.97] transition-transform overflow-hidden ${fillRow ? "col-span-2" : ""}`}
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
