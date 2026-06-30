"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogOut, ChevronsLeft, ChevronsRight, ChevronDown, LayoutDashboard, Users, Briefcase,
  Radio, Package, PackagePlus, Factory, ClipboardList, Receipt, AlertTriangle,
  Home, Settings, PackageCheck, ClipboardCheck, Truck,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ColorimetrieSwitcher } from "@/components/ColorimetrieSwitcher";
import { SapEnvSwitch } from "@/components/SapEnvSwitch";
import { SignalLoader } from "@/components/ui/page-loader";
import { SPRING } from "@/lib/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Sidebar gauche — remplace la Navbar horizontale (9 liens à plat devenus
 * illisibles). Regroupement par domaine métier :
 *
 *   ACCUEIL     — hub principal (badge notifications non lues, refresh ~60 s)
 *   OPÉRATIONS  — le quotidien télévente : Console, Plan d'appel, Clients
 *   LOGISTIQUE  — Stock, Entrées (badge incidents ouverts), Fabrication
 *   PILOTAGE    — Stats, Encours, Effectifs
 *   SYSTÈME     — Paramètres
 *   (footer)    — bascule SAP, colorimétrie, thème, compte
 *
 * NB : « Promotions » a quitté la sidebar — la page /promos reste accessible
 * via l'accueil et l'écran de commande (bouton dédié, chantier parallèle).
 *
 * Rail rétractable (68 px ↔ 236 px, persisté localStorage), pastille active
 * animée (layoutId partagé), tooltips en mode rail. DA « salle de signal » :
 * fond #0b1018 constant, accents brand, glow discret.
 */

const STORAGE_KEY = "televent-sidebar";
const W_FULL = 236;
const W_RAIL = 68;

interface NavItem {
  href: string;
  label: string;
  icon: typeof Radio;
  /** clé de badge dynamique (cf. useBadges) */
  badge?: "receptionIncidents" | "notifications" | "commandesDue" | "inventairePending";
}

const GROUPS: { label: string | null; items: NavItem[]; collapsible?: boolean }[] = [
  {
    // Accueil — hors groupe, toujours en tête (label null = pas d'en-tête)
    label: null,
    items: [
      { href: "/accueil", label: "Accueil", icon: Home, badge: "notifications" },
    ],
  },
  {
    // Cœur télévente — le quotidien, toujours visible (televent first).
    label: "Télévente",
    items: [
      { href: "/console", label: "Console", icon: Radio },
      { href: "/plan-appel", label: "Plan d'appel", icon: ClipboardList },
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/livraisons", label: "Détail livraison", icon: Truck },
    ],
  },
  {
    // Suivi quotidien — stock dispo + pilotage en un coup d'œil.
    label: "Stock & stats",
    items: [
      { href: "/products", label: "Stock", icon: Package },
      { href: "/dashboard", label: "Stats", icon: LayoutDashboard },
    ],
  },
  {
    // Gestion — pages moins quotidiennes, repliées par défaut (1 clic pour
    // déplier). Rien n'est masqué : le groupe s'ouvre seul si on est dessus.
    label: "Gestion",
    collapsible: true,
    items: [
      { href: "/entrees", label: "Entrées", icon: PackagePlus, badge: "receptionIncidents" },
      { href: "/commandes-fournisseurs", label: "Cmd. fourn.", icon: PackageCheck, badge: "commandesDue" },
      { href: "/inventaire", label: "Inventaire", icon: ClipboardCheck, badge: "inventairePending" },
      { href: "/fabrication", label: "Fabrication", icon: Factory },
      { href: "/encours", label: "Encours", icon: Receipt },
      { href: "/commerciaux", label: "Effectifs", icon: Briefcase },
    ],
  },
  {
    label: "Système",
    items: [
      { href: "/parametres", label: "Paramètres", icon: Settings },
    ],
  },
];

/** Style de la pastille de comptage par type de badge. */
const BADGE_STYLE: Record<NonNullable<NavItem["badge"]>, string> = {
  receptionIncidents: "bg-amber-500 text-[#0b1018]",
  notifications: "bg-brand-500 text-white",
  commandesDue: "bg-amber-500 text-[#0b1018]",
  inventairePending: "bg-amber-500 text-[#0b1018]",
};

/**
 * Badges dynamiques de la sidebar.
 *  - incidents réception : 1 fetch au montage (léger) ;
 *  - notifications (Accueil) : refresh ~60 s, compte les non lues (isNew).
 * Tout est défensif : un endpoint absent/HS = badge masqué, jamais d'erreur.
 */
function useBadges(): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/entrees/incidents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.incidents) return;
        const open = (j.incidents as { resolved: boolean }[]).filter((i) => !i.resolved).length;
        setBadges((b) => ({ ...b, receptionIncidents: open }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/notifications", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled || !Array.isArray(j?.notifications)) return;
          const unread = (j.notifications as { isNew?: boolean }[]).filter((n) => n?.isNew).length;
          setBadges((b) => ({ ...b, notifications: unread }));
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Commandes fournisseurs arrivées à échéance (à réceptionner) — refresh ~2 min.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/sap/purchase-orders/due-count", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && typeof j?.count === "number") setBadges((b) => ({ ...b, commandesDue: j.count })); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Inventaires soumis non revus (admin / préparateur) — refresh ~2 min.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/inventaire", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && typeof j?.pendingReview === "number") setBadges((b) => ({ ...b, inventairePending: j.pendingReview })); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return badges;
}

export function Sidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [rail, setRail] = useState(false);
  const badges = useBadges();
  // Voile de navigation : label de la page en cours d'ouverture (null = caché).
  const [pending, setPending] = useState<string | null>(null);
  // Groupe « Gestion » repliable (pages moins quotidiennes) — état persistant.
  const [gestionOpen, setGestionOpen] = useState(false);
  useEffect(() => {
    try { setGestionOpen(localStorage.getItem("televent-sidebar-gestion") === "open"); } catch { /* ignore */ }
  }, []);
  const toggleGestion = () =>
    setGestionOpen((o) => {
      try { localStorage.setItem("televent-sidebar-gestion", o ? "closed" : "open"); } catch { /* ignore */ }
      return !o;
    });

  /** Item actif (même logique qu'avant : exact, accueil≡/, sinon préfixe sauf /dashboard). */
  const isActive = (href: string) =>
    pathname === href ||
    (href === "/accueil" && pathname === "/") ||
    (href !== "/dashboard" && pathname.startsWith(href));

  // Persistance du mode rail (lu après hydratation pour éviter un mismatch SSR).
  useEffect(() => {
    try { setRail(localStorage.getItem(STORAGE_KEY) === "rail"); } catch { /* ignore */ }
  }, []);

  // La navigation a abouti (le pathname a changé, ou la page est re-rendue) →
  // on retire le voile. Filet de sécurité 8 s si la route ne commit jamais
  // (ex. ouverture dans un autre onglet via clic modifié non détecté).
  useEffect(() => { setPending(null); }, [pathname]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 8_000);
    return () => clearTimeout(t);
  }, [pending]);
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
    <>
    <motion.aside
      animate={{ width: rail ? W_RAIL : W_FULL }}
      transition={SPRING.soft}
      className="sticky top-0 h-screen shrink-0 z-50 hidden md:flex flex-col bg-[#0b1018] border-r border-white/[0.07] overflow-hidden"
    >
      {/* Liseré signal — fine colonne dégradée côté contenu */}
      <span aria-hidden className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-brand-500/40 to-transparent" />

      {/* ── Logo + collapse ─────────────────────────────── */}
      <div className={`flex items-center h-[60px] shrink-0 ${rail ? "justify-center px-0" : "justify-between pl-5 pr-3"}`}>
        <Link href="/" className="flex items-center gap-2.5 group select-none" title="TeleVent — Accueil">
          <div className="relative flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-gradient-to-br from-brand-500 to-brand-700 transition-all duration-300 group-hover:from-brand-400 group-hover:to-brand-600 group-hover:shadow-[0_0_18px_hsl(var(--brand-500)/0.55)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none">
              <path d="M3 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M7 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M11 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M15 8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M19 11v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-[#0b1018] animate-soft-pulse" />
          </div>
          <AnimatePresence initial={false}>
            {!rail && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                className="text-[15px] font-semibold tracking-[-0.02em] text-white/90 group-hover:text-white transition-colors whitespace-nowrap"
              >
                Tele<span className="text-brand-400 italic font-light">Vent</span>
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
        {!rail && (
          <button
            onClick={toggleRail}
            title="Réduire le menu"
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/35 hover:text-white/75 hover:bg-white/[0.06] transition-colors"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Navigation groupée ─────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2 pt-1 space-y-4">
        {GROUPS.map((group) => {
          const collapsible = !!group.collapsible && !rail;
          const hasActive = group.items.some((it) => isActive(it.href));
          // Replié par défaut ; s'ouvre seul si la page active est dedans.
          const open = !collapsible || gestionOpen || hasActive;
          return (
          <div key={group.label ?? "accueil"}>
            {group.label !== null && (rail ? (
              <div className="mx-2 mb-2 h-px bg-white/[0.07]" />
            ) : collapsible ? (
              <button
                type="button"
                onClick={toggleGestion}
                aria-expanded={open}
                className="w-full px-2 mb-1.5 flex items-center justify-between text-[9.5px] uppercase tracking-[0.18em] font-bold text-white/55 hover:text-white/75 transition-colors"
              >
                <span className="whitespace-nowrap">{group.label}</span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
              </button>
            ) : (
              <p className="px-2 mb-1.5 text-[9.5px] uppercase tracking-[0.18em] font-bold text-white/55 whitespace-nowrap">
                {group.label}
              </p>
            ))}
            {open && (
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon, badge }) => {
                const active = isActive(href);
                const badgeCount = badge ? badges[badge] ?? 0 : 0;
                return (
                  <li key={href} className="relative group/item">
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      onClick={(e) => {
                        // Pas de voile si déjà sur la page, ou clic modifié
                        // (nouvel onglet : ctrl/cmd/shift/clic molette).
                        if (active || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                        setPending(label);
                      }}
                      title={rail ? label : undefined}
                      className={`relative flex items-center rounded-lg h-9 transition-colors duration-150 ${
                        rail ? "justify-center px-0" : "gap-3 px-2.5"
                      } ${active ? "text-white" : "text-white/70 hover:text-white/85 hover:bg-white/[0.05]"}`}
                    >
                      {/* Pastille active animée — glisse d'un item à l'autre */}
                      {active && (
                        <motion.span
                          layoutId="sidebar-active"
                          transition={SPRING.snappy}
                          className="absolute inset-0 rounded-lg bg-white/[0.08] shadow-[inset_2px_0_0_0_hsl(var(--brand-500,45_96%_42%))]"
                          style={{ boxShadow: "inset 2.5px 0 0 0 hsl(var(--brand-500)), 0 0 18px hsl(var(--brand-500) / 0.12)" }}
                        />
                      )}
                      <span className="relative shrink-0">
                        <Icon className={`h-[21px] w-[21px] ${active ? "text-brand-400" : ""}`} strokeWidth={active ? 2.2 : 1.8} />
                        {badge && badgeCount > 0 && (
                          <span className={`absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center ring-2 ring-[#0b1018] ${BADGE_STYLE[badge]}`}>
                            {badgeCount > 9 ? "9+" : badgeCount}
                          </span>
                        )}
                      </span>
                      <AnimatePresence initial={false}>
                        {!rail && (
                          <motion.span
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -4 }}
                            className="relative text-[13px] font-medium whitespace-nowrap flex-1"
                          >
                            {label}
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {!rail && badge === "receptionIncidents" && badgeCount > 0 && (
                        <span className="relative flex items-center gap-1 text-[10px] font-bold text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          {badgeCount}
                        </span>
                      )}
                      {!rail && badge === "notifications" && badgeCount > 0 && (
                        <span
                          className="relative inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500/20 text-brand-300 text-[10px] font-bold tnum"
                          title={`${badgeCount} notification${badgeCount > 1 ? "s" : ""} non lue${badgeCount > 1 ? "s" : ""}`}
                        >
                          {badgeCount > 9 ? "9+" : badgeCount}
                        </span>
                      )}
                    </Link>
                    {/* Tooltip en mode rail */}
                    {rail && (
                      <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2.5 py-1.5 rounded-lg bg-[#161b26] border border-white/[0.09] text-[12px] font-medium text-white/90 whitespace-nowrap opacity-0 translate-x-[-4px] group-hover/item:opacity-100 group-hover/item:translate-x-0 transition-all duration-150 shadow-xl z-50">
                        {label}
                        {badgeCount > 0 && <span className="ml-1.5 text-amber-400 font-bold">· {badgeCount}</span>}
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

      {/* ── Footer système ─────────────────────────────── */}
      <div className="shrink-0 border-t border-white/[0.07] px-3 py-3 space-y-2.5">
        {/* Bascule SAP prod/test — masquée en rail (badge trop large) */}
        {!rail && <SapEnvSwitch />}

        <div className={`flex items-center ${rail ? "flex-col gap-1.5" : "gap-1"}`}>
          <ColorimetrieSwitcher />
          <ThemeToggle />
          {rail && (
            <button
              onClick={toggleRail}
              title="Déployer le menu"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white/35 hover:text-white/75 hover:bg-white/[0.06] transition-colors"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`flex items-center rounded-lg hover:bg-white/[0.06] transition-colors w-full focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${
                  rail ? "justify-center py-1.5" : "gap-2.5 px-2 py-1.5"
                }`}
              >
                <div className="h-[28px] w-[28px] rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-[10.5px] font-bold shadow-[0_0_0_2px_hsl(var(--brand-500)/0.25)] shrink-0">
                  {initials}
                </div>
                {!rail && (
                  <span className="text-[12.5px] text-white/60 truncate text-left flex-1">
                    {session.user.name?.split(" ")[0] || session.user.email?.split("@")[0]}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-58 mb-1 rounded-xl border-white/[0.08] dark:border-white/[0.06] bg-white dark:bg-[#16181f] shadow-modal p-1">
              <div className="px-3 py-2.5">
                <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-none">
                  {session.user.name}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 truncate">
                  {session.user.email}
                </p>
              </div>
              <DropdownMenuSeparator className="my-1 dark:bg-white/[0.06]" />
              <DropdownMenuItem
                className="text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-300 focus:bg-rose-50 dark:focus:bg-rose-900/20 cursor-pointer rounded-lg text-[13px] gap-2"
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

    {/* ── Voile de navigation — grise l'écran pendant l'ouverture d'une page.
         Disparaît au commit de la route (changement de pathname) ; le
         loading.tsx de la section prend alors le relais dans le contenu. ── */}
    <AnimatePresence>
      {pending && (
        <motion.div
          key="nav-veil"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed inset-0 z-[70] bg-[#0b1018]/55 flex items-center justify-center cursor-progress"
          aria-live="polite"
          aria-label={`Ouverture de ${pending}`}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={SPRING.snappy}
            className="flex items-center gap-4 rounded-2xl border border-white/[0.1] bg-[#11161f] px-6 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.5),0_0_30px_hsl(var(--brand-500)/0.12)]"
          >
            <SignalLoader />
            <div>
              <p className="text-[13px] font-semibold text-white/90 leading-tight">{pending}</p>
              <p className="text-[11px] text-white/45 mt-0.5">Ouverture de la page…</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
