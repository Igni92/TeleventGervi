"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogOut, ChevronsLeft, ChevronsRight, ChevronDown, Eye, Pencil, Loader2,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";
import { SapEnvSwitch } from "@/components/SapEnvSwitch";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { navAllowedForRoles } from "@/lib/rolePreview";
import {
  NAV_GROUPS, NAV_FOOTER, isItemActive,
  type NavItem, type NavBadgeKey,
} from "@/lib/navigation";
import { useNavBadges } from "@/lib/useNavBadges";
import { applyNavConfig, type NavConfig } from "@/lib/navOverrides";
import { SPRING } from "@/lib/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Sidebar gauche — refonte « Réglages macOS » sur le design system tokenisé :
 * fond hsl(var(--card)) (clair en thème jour), filet hairline à droite,
 * item actif = teinte or discrète (bg-primary/14), libellés de groupe en
 * .kicker. Plus de fond sombre codé en dur, plus de glow, plus de voile de
 * navigation plein écran (les loading.tsx de section suffisent).
 *
 * La STRUCTURE vient de lib/navigation (NAV_GROUPS / NAV_FOOTER) et les
 * compteurs de lib/useNavBadges (un seul endpoint agrégé, plus de polling
 * local). La personnalisation admin (renommage / déplacement, PUT
 * /api/nav-overrides) vit dans SidebarEditMode, chargé dynamiquement au clic
 * sur le crayon uniquement.
 *
 * Conservé : rail 68 px ↔ 236 px persisté (localStorage televent-sidebar),
 * tooltips en mode rail, état plié/déplié par groupe, bascule SAP (avec
 * confirmation interne), retour « Vue réelle » de l'aperçu rôle, déconnexion.
 */

const STORAGE_KEY = "televent-sidebar";
const W_FULL = 236;
const W_RAIL = 68;

/** Badges « à traiter » (rouge système) — les autres restent neutres. */
const DESTRUCTIVE_BADGES: ReadonlySet<NavBadgeKey> = new Set<NavBadgeKey>([
  "incidents",
  "inventaire",
]);

/** Pilule de comptage (mode déplié) — caption2, neutre ou destructive. */
function CountPill({ badge, count }: { badge: NavBadgeKey; count: number }) {
  return (
    <span
      className={`relative shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-caption2 leading-none font-semibold tnum ${
        DESTRUCTIVE_BADGES.has(badge)
          ? "bg-destructive/12 text-destructive"
          : "bg-secondary text-muted-foreground"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Mode ÉDITION (admin) : chargé UNIQUEMENT au clic sur le crayon — le code de
// drag-drop / renommage / catégories (~350 lignes) ne pèse pas sur chaque page.
const SidebarEditMode = nextDynamic(() => import("@/components/SidebarEditMode"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  ),
});

export function Sidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { previewRoles, previewLabel, clearPreview, canPreview } = useRolePreview();
  const [rail, setRail] = useState(false);
  const badges = useNavBadges();

  // ── Personnalisation (libellés + emplacement) — réglage GLOBAL, chargé au
  //    montage (best-effort). Les surcharges qui référencent une entrée
  //    disparue (ex. l'ancienne « Console de commande » /console/ecran2) sont
  //    ignorées sans casser : applyNavConfig ne place que les items existants. ──
  const [navConfig, setNavConfig] = useState<NavConfig>({ items: {}, categories: [] });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/nav-overrides", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.ok && j.config) setNavConfig(j.config); })
      .catch(() => { /* réglage optionnel */ });
    return () => { cancelled = true; };
  }, []);
  const groups = useMemo(() => applyNavConfig(NAV_GROUPS, navConfig), [navConfig]);

  // Mode ÉDITION (crayon, admin) — toute la logique vit dans SidebarEditMode.
  const [editingNav, setEditingNav] = useState(false);

  // ── Groupes pliables — TOUS les groupes nommés de 1er niveau, état persisté
  //    par groupe (clé televent-sidebar-group:<label>, dépliés par défaut). ──
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const next: Record<string, boolean> = {};
      for (const g of groups) {
        if (g.label && !g.parent) {
          next[g.label] = localStorage.getItem(`televent-sidebar-group:${g.label}`) === "closed";
        }
      }
      setClosedGroups(next);
    } catch { /* storage indispo */ }
  }, [groups]);
  const toggleGroup = (label: string) =>
    setClosedGroups((cur) => {
      const closed = !cur[label];
      try { localStorage.setItem(`televent-sidebar-group:${label}`, closed ? "closed" : "open"); } catch { /* ignore */ }
      return { ...cur, [label]: closed };
    });

  /** Ouverture par groupe de 1er niveau : plié seulement si l'utilisateur l'a
   *  plié ET qu'aucune page active n'est dedans (on ne cache jamais la page
   *  courante). Les sous-catégories suivent leur parent. */
  const openMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const g of groups) {
      if (!g.label) continue;
      const top = g.parent ?? g.label;
      if (g.items.some((it) => isItemActive(it, pathname))) m[top] = true;
    }
    for (const g of groups) {
      if (!g.label || g.parent) continue;
      if (m[g.label] === undefined) m[g.label] = !closedGroups[g.label];
    }
    return m;
  }, [groups, closedGroups, pathname]);

  // Persistance du mode rail (lu après hydratation pour éviter un mismatch SSR).
  useEffect(() => {
    try { setRail(localStorage.getItem(STORAGE_KEY) === "rail"); } catch { /* ignore */ }
  }, []);
  const toggleRail = () => {
    setRail((r) => {
      try { localStorage.setItem(STORAGE_KEY, r ? "full" : "rail"); } catch { /* ignore */ }
      return !r;
    });
  };

  const initials = (session?.user?.name || session?.user?.email || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <motion.aside
      animate={{ width: rail ? W_RAIL : W_FULL }}
      transition={SPRING.soft}
      className="app-sidebar sticky top-0 h-screen shrink-0 z-50 hidden md:flex touch:!hidden flex-col bg-card border-r-[length:var(--hairline)] border-border overflow-hidden"
    >
      {/* ── Logo + collapse ─────────────────────────────── */}
      <div className={`flex items-center h-[60px] shrink-0 ${rail ? "justify-center px-0" : "justify-between pl-5 pr-3"}`}>
        <Link href="/" className="flex items-center gap-2.5 group select-none" title="Gervi — Accueil">
          <div className="flex h-[30px] w-[30px] items-center justify-center transition-transform duration-300 group-hover:scale-110">
            <Logo className="h-[28px] w-[28px]" />
          </div>
          <AnimatePresence initial={false}>
            {!rail && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                className="text-callout font-bold tracking-[-0.02em] text-foreground whitespace-nowrap"
              >
                Gerv<span className="text-primary">i</span>
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
        {!rail && (
          <div className="flex items-center gap-0.5">
            {/* Mode MODIFICATION de la nav (admin/direction) : renommer + déplacer. */}
            {canPreview && (
              <button
                onClick={() => setEditingNav((e) => !e)}
                title={editingNav ? "Quitter le mode modification (sans enregistrer)" : "Modifier la navigation — renommer les entrées, changer leur zone"}
                aria-pressed={editingNav}
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                  editingNav
                    ? "bg-primary/14 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={toggleRail}
              title="Réduire le menu"
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Navigation groupée (ou mode édition, chargé à la demande) ── */}
      {editingNav ? (
        <SidebarEditMode
          navConfig={navConfig}
          onSaved={(config) => { setNavConfig(config); setEditingNav(false); }}
          onClose={() => setEditingNav(false)}
        />
      ) : (
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2 pt-1 space-y-4">
        {groups.map((group) => {
          // Aperçu « voir comme » : on masque les entrées hors périmètre du rôle
          // prévisualisé. Sans aperçu : tout visible.
          const items = group.items.filter((it) => navAllowedForRoles(it.href, previewRoles));
          const isSub = !!group.parent;
          const topLabel = group.parent ?? group.label;
          const open = rail || !topLabel || (openMap[topLabel] ?? true);

          // Catégorie de 1er niveau SANS entrée directe : ne reste que si une de
          // ses sous-catégories a des entrées visibles (elle sert d'en-tête).
          const headerOnly = group.label !== null && !isSub && group.items.length === 0;
          if (headerOnly) {
            const hasVisibleSub = groups.some(
              (g) => g.parent === group.label && g.items.some((it) => navAllowedForRoles(it.href, previewRoles)),
            );
            if (!hasVisibleSub) return null;
          } else if (items.length === 0) {
            return null;
          }
          // Sous-catégorie d'un groupe plié : masquée avec lui (jamais en rail).
          if (isSub && !rail && topLabel && !(openMap[topLabel] ?? true)) return null;

          return (
            <div key={group.label ?? "accueil"} className={isSub && !rail ? "ml-3 border-l-[length:var(--hairline)] border-border pl-2 -mt-2" : ""}>
              {group.label !== null && (rail ? (
                !isSub && <div className="mx-2 mb-2 h-px bg-border" />
              ) : isSub ? (
                <p className="kicker px-2 mb-1 whitespace-nowrap">{group.label}</p>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label!)}
                  aria-expanded={open}
                  className="w-full px-2 mb-1.5 flex items-center justify-between text-left group/head"
                >
                  <span className="kicker whitespace-nowrap transition-colors group-hover/head:text-foreground">{group.label}</span>
                  <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
                </button>
              ))}
              {open && items.length > 0 && (
                <ul className="space-y-0.5">
                  {items.map((it) => {
                    const { href, label, icon: Icon, badge } = it;
                    const active = isItemActive(it, pathname);
                    const count = badge ? badges[badge] ?? 0 : 0;
                    return (
                      <li key={href} className="relative group/item">
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                          title={rail ? label : undefined}
                          className={`relative flex items-center h-9 rounded-lg transition-colors duration-150 ${
                            rail ? "justify-center px-0" : "gap-3 px-3"
                          } ${active ? "text-foreground font-semibold" : "text-foreground/75 hover:text-foreground hover:bg-secondary"}`}
                        >
                          {/* Pastille active partagée — glisse d'un item à l'autre. */}
                          {active && (
                            <motion.span
                              layoutId="sidebar-active"
                              transition={SPRING.snappy}
                              className="absolute inset-0 rounded-lg bg-primary/20 ring-1 ring-primary/25"
                            />
                          )}
                          <span className="relative shrink-0">
                            <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.8} />
                            {/* Compteur en mode rail : petite pilule sur l'icône. */}
                            {rail && badge && count > 0 && (
                              <span
                                className={`absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-caption2 leading-none font-bold flex items-center justify-center ring-2 ring-card ${
                                  DESTRUCTIVE_BADGES.has(badge)
                                    ? "bg-destructive text-destructive-foreground"
                                    : "bg-primary text-primary-foreground"
                                }`}
                              >
                                {count > 9 ? "9+" : count}
                              </span>
                            )}
                          </span>
                          <AnimatePresence initial={false}>
                            {!rail && (
                              <motion.span
                                initial={{ opacity: 0, x: -4 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -4 }}
                                className="relative text-body whitespace-nowrap flex-1 truncate"
                              >
                                {label}
                              </motion.span>
                            )}
                          </AnimatePresence>
                          {!rail && badge && count > 0 && <CountPill badge={badge} count={count} />}
                        </Link>
                        {/* Tooltip en mode rail */}
                        {rail && (
                          <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2.5 py-1.5 rounded-lg bg-popover border-[length:var(--hairline)] border-border text-caption font-medium text-popover-foreground whitespace-nowrap opacity-0 translate-x-[-4px] group-hover/item:opacity-100 group-hover/item:translate-x-0 transition-all duration-150 shadow-modal z-50">
                            {label}
                            {count > 0 && (
                              <span className={`ml-1.5 font-bold ${badge && DESTRUCTIVE_BADGES.has(badge) ? "text-destructive" : "text-muted-foreground"}`}>
                                · {count}
                              </span>
                            )}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      )}

      {/* ── Footer système ─────────────────────────────── */}
      <div className="shrink-0 border-t-[length:var(--hairline)] border-border px-3 py-3 space-y-2.5">
        {/* « Voir comme » vit dans Effectifs — ici, seul le retour rapide
            « Vue réelle » reste pour ne jamais rester bloqué dans un aperçu. */}
        {!rail && previewLabel && (
          <button
            type="button"
            onClick={clearPreview}
            title="Quitter l'aperçu et revenir à la vue réelle"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 h-9 text-caption font-medium bg-warning/12 text-warning ring-1 ring-warning/25 hover:bg-warning/15 transition-colors"
          >
            <Eye className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">Aperçu : {previewLabel}</span>
            <span className="ml-auto text-caption2 font-semibold underline underline-offset-2">Vue réelle</span>
          </button>
        )}

        {/* Bascule SAP prod/test (confirmation interne) — masquée en rail. */}
        {!rail && <SapEnvSwitch />}

        <div className={`flex items-center ${rail ? "flex-col gap-1.5" : "gap-1"}`}>
          <ThemeToggle />
          {/* Engrenage Paramètres (NAV_FOOTER) — le groupe SYSTÈME a disparu. */}
          {NAV_FOOTER.map((it) => {
            const Icon = it.icon;
            const active = isItemActive(it, pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                title={it.label}
                aria-current={active ? "page" : undefined}
                className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                  active
                    ? "bg-primary/14 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              </Link>
            );
          })}
          {rail && (
            <button
              onClick={toggleRail}
              title="Déployer le menu"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`flex items-center rounded-lg hover:bg-secondary transition-colors w-full focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  rail ? "justify-center py-1.5" : "gap-2.5 px-2 py-1.5"
                }`}
              >
                <div className="h-7 w-7 rounded-full bg-primary/14 text-primary ring-1 ring-primary/20 flex items-center justify-center text-caption2 font-bold shrink-0">
                  {initials}
                </div>
                {!rail && (
                  <span className="text-caption text-muted-foreground truncate text-left flex-1">
                    {session.user.name?.split(" ")[0] || session.user.email?.split("@")[0]}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56 mb-1 rounded-xl shadow-modal p-1">
              <div className="px-3 py-2.5">
                <p className="text-body font-semibold text-foreground leading-none">
                  {session.user.name}
                </p>
                <p className="text-caption2 text-muted-foreground mt-1 truncate">
                  {session.user.email}
                </p>
              </div>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive focus:bg-destructive/12 cursor-pointer rounded-lg text-body gap-2"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-3.5 w-3.5" />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </motion.aside>
  );
}
