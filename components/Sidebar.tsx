"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogOut, ChevronsLeft, ChevronsRight, ChevronDown, LayoutDashboard, Users, Briefcase,
  Radio, Package, PackagePlus, Factory, Receipt, AlertTriangle,
  Home, Settings, PackageCheck, ClipboardCheck, ClipboardList, Truck, Eye, Store, PackageX,
  Pencil, Loader2, RotateCcw, ScrollText, GripVertical, FolderPlus, Plus, Trash2, ChevronUp, CornerDownRight, Check,
} from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";
import { SapEnvSwitch } from "@/components/SapEnvSwitch";
import { SignalLoader } from "@/components/ui/page-loader";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { navAllowedForPreview, PREVIEW_ROLE_LABELS } from "@/lib/rolePreview";
import {
  applyNavConfig, toNavEditState, fromNavEditState, moveNavRowBefore, swapNavRows,
  addNavCategory, addNavSubCategory, renameNavCategory, deleteNavCategory, moveNavCategory, moveNavCategoryBefore, swapNavCategory,
  type NavConfig, type NavEditGroup,
} from "@/lib/navOverrides";
import { SPRING } from "@/lib/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Sidebar gauche — regroupement par MÉTIER, dans l'ordre du flux (vente →
 * entrepôt → achats → pilotage) :
 *
 *   ACCUEIL     — hub principal (badge notifications non lues, refresh ~60 s)
 *   TÉLÉVENTE   — Console d'appels, Clients & plan d'appel (fusionnés sous une
 *                 même entrée, onglets in-page), Ventes du jour (mise en prép)
 *   ENTREPÔT    — Préparation livraisons, Stock, Inventaire, Fabrication
 *   ACHATS      — Commandes fournisseurs → Entrées marchandises (flux CF → EM,
 *                 replié par défaut : moins quotidien sur poste télévente)
 *   PILOTAGE    — Statistiques, Encours clients, Équipe commerciale
 *   SYSTÈME     — Paramètres
 *   (footer)    — bascule SAP, thème, compte
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
  /** Autres préfixes de route couverts par cette entrée (ex. entrée fusionnée
   *  « Clients & plan d'appel » active aussi sur /plan-appel). */
  also?: string[];
}

/** Structure de navigation PAR DÉFAUT — personnalisable (libellés + emplacement)
 *  via Paramètres › Navigation (lib/navOverrides), exportée pour le panneau. */
export const NAV_GROUPS: { label: string | null; items: NavItem[]; collapsible?: boolean }[] = [
  {
    // Accueil — hors groupe, toujours en tête (label null = pas d'en-tête)
    label: null,
    items: [
      { href: "/accueil", label: "Accueil", icon: Home, badge: "notifications" },
    ],
  },
  {
    // Cœur télévente — le quotidien du commercial, toujours visible.
    label: "Télévente",
    items: [
      { href: "/console", label: "Console d'appels", icon: Radio },
      // Clients & plan d'appel FUSIONNÉS : une seule entrée, onglets in-page.
      { href: "/clients", label: "Clients & plan d'appel", icon: Users, also: ["/plan-appel"] },
      { href: "/ventes-du-jour", label: "Ventes du jour", icon: Store },
    ],
  },
  {
    // Entrepôt — la marchandise qui sort (préparation) + ce qu'on a en rayon.
    label: "Entrepôt",
    items: [
      { href: "/livraisons", label: "Préparation livraisons", icon: Truck },
      { href: "/preparations", label: "Préparations à faire", icon: ClipboardList },
      { href: "/bons-commande", label: "Bons de commande", icon: ScrollText },
      { href: "/manquants", label: "Manquants", icon: PackageX },
      { href: "/products", label: "Stock", icon: Package },
      { href: "/inventaire", label: "Inventaire", icon: ClipboardCheck, badge: "inventairePending" },
      { href: "/fabrication", label: "Fabrication", icon: Factory },
    ],
  },
  {
    // Achats — le flux CF → EM (poste acheteur / agréeur), replié par défaut
    // (1 clic pour déplier). Rien n'est masqué : s'ouvre seul si on est dessus.
    label: "Achats",
    collapsible: true,
    items: [
      { href: "/commandes-fournisseurs", label: "Commandes fournisseurs", icon: PackageCheck, badge: "commandesDue" },
      { href: "/entrees", label: "Entrées marchandises", icon: PackagePlus, badge: "receptionIncidents" },
    ],
  },
  {
    // Pilotage — chiffres et équipe (direction / compta).
    label: "Pilotage",
    items: [
      { href: "/dashboard", label: "Statistiques", icon: LayoutDashboard },
      { href: "/encours", label: "Encours clients", icon: Receipt },
      { href: "/commerciaux", label: "Équipe commerciale", icon: Briefcase },
    ],
  },
  {
    label: "Système",
    items: [
      { href: "/parametres", label: "Paramètres", icon: Settings },
    ],
  },
];

/** Icône d'origine par route — le mode ÉDITION garde l'icône même renommée/déplacée. */
const ICON_BY_HREF = new Map<string, typeof Radio>(
  NAV_GROUPS.flatMap((g) => g.items.map((it) => [it.href, it.icon] as [string, typeof Radio])),
);
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
  const { previewRole, setPreviewRole, canPreview } = useRolePreview();
  const [rail, setRail] = useState(false);
  const badges = useBadges();
  // Voile de navigation : label de la page en cours d'ouverture (null = caché).
  const [pending, setPending] = useState<string | null>(null);
  // ── Personnalisation (libellés + emplacement) — réglage GLOBAL, chargé au
  //    montage (best-effort) et édité EN PLACE via le mode modification
  //    ci-dessous (bouton crayon, admin/direction). ──
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

  // ── MODE MODIFICATION de la nav (crayon) : renommer les entrées et changer
  //    leur zone (groupe + ordre) directement dans la barre. Brouillon local,
  //    Enregistrer = PUT /api/nav-overrides (réglage global, garde admin). ──
  const [editingNav, setEditingNav] = useState(false);
  const [draft, setDraft] = useState<NavEditGroup[]>([]);
  const [savingNav, setSavingNav] = useState(false);
  // Glisser-déposer natif du brouillon : href tiré + zone survolée (clé unique
  // `gap:<groupe>:<avant>` pour un interstice, `row:<href>` pour une ligne).
  const [dragHref, setDragHref] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const endDrag = () => { setDragHref(null); setOverKey(null); setOverCat(null); };
  const dropBefore = (toGroup: string, beforeHref: string | null) => {
    if (dragHref) setDraft((cur) => moveNavRowBefore(cur, dragHref, toGroup, beforeHref));
    endDrag();
  };
  const dropOnRow = (targetHref: string) => {
    if (dragHref && dragHref !== targetHref) setDraft((cur) => swapNavRows(cur, dragHref, targetHref));
    endDrag();
  };
  // Glisser-déposer des CATÉGORIES de 1er niveau (bloc entier). État séparé du
  // drag des entrées : on ne mélange jamais les deux gestes.
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);
  const endCatDrag = () => { setDragCat(null); setOverCat(null); };
  // Édition du LIBELLÉ (crayon) — une seule entrée/catégorie à la fois. Pour les
  // catégories, la clé = le libellé (donc renommer changerait la clé) : on bufferise
  // la saisie et on ne renomme qu'à la validation (garde le focus, pas de remontage).
  const [editKey, setEditKey] = useState<string | null>(null);   // `row:<href>` | `cat:<label>`
  const [catDraftLabel, setCatDraftLabel] = useState("");
  const startEditCat = (label: string) => { setCatDraftLabel(label); setEditKey(`cat:${label}`); };
  const commitEditCat = (label: string) => {
    if (catDraftLabel.trim() && catDraftLabel.trim() !== label) renameCategory(label, catDraftLabel);
    setEditKey(null);
  };
  const startEditNav = () => {
    setDraft(toNavEditState(NAV_GROUPS, navConfig));
    setEditingNav(true);
    if (rail) toggleRail();   // l'édition a besoin de la largeur complète
  };
  const cancelEditNav = () => { setEditingNav(false); setDraft([]); };
  const renameDraft = (href: string, label: string) =>
    setDraft((cur) => cur.map((g) => ({ ...g, rows: g.rows.map((r) => (r.href === href ? { ...r, label } : r)) })));
  // ── Catégories & sous-catégories (création dans la barre) ──
  const addCategory = () => setDraft((cur) => addNavCategory(cur));
  const addSubCategory = (parent: string) => setDraft((cur) => addNavSubCategory(cur, parent));
  const renameCategory = (label: string, next: string) => setDraft((cur) => renameNavCategory(cur, label, next));
  const removeCategory = (label: string) => setDraft((cur) => deleteNavCategory(cur, label));
  const shiftCategory = (label: string, dir: -1 | 1) => setDraft((cur) => moveNavCategory(cur, label, dir));
  const dropCatBefore = (beforeLabel: string | null) => {
    if (dragCat) setDraft((cur) => moveNavCategoryBefore(cur, dragCat, beforeLabel));
    endCatDrag();
  };
  const swapCat = (target: string) => {
    if (dragCat && dragCat !== target) setDraft((cur) => swapNavCategory(cur, dragCat, target));
    endCatDrag();
  };
  async function saveNav(config: NavConfig, successMsg: string) {
    setSavingNav(true);
    try {
      const r = await fetch("/api/nav-overrides", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de l'enregistrement");
      setNavConfig(j.config ?? { items: {}, categories: [] });
      setEditingNav(false);
      setDraft([]);
      toast.success(successMsg, { description: "Réglage global — les autres postes l'auront au prochain chargement." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setSavingNav(false);
    }
  }
  // Groupes repliables (pages moins quotidiennes) — état persistant PAR groupe
  // (clé `televent-sidebar-group:<label>`). Repliés par défaut.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const next: Record<string, boolean> = {};
      for (const g of NAV_GROUPS) {
        if (g.collapsible && g.label) next[g.label] = localStorage.getItem(`televent-sidebar-group:${g.label}`) === "open";
      }
      setOpenGroups(next);
    } catch { /* ignore */ }
  }, []);
  const toggleGroup = (label: string) =>
    setOpenGroups((cur) => {
      const open = !cur[label];
      try { localStorage.setItem(`televent-sidebar-group:${label}`, open ? "open" : "closed"); } catch { /* ignore */ }
      return { ...cur, [label]: open };
    });

  /** Préfixe de route actif (exact, accueil≡/, sinon préfixe sauf /dashboard). */
  const isActiveHref = (href: string) =>
    pathname === href ||
    (href === "/accueil" && pathname === "/") ||
    (href !== "/dashboard" && pathname.startsWith(href));
  /** Item actif — couvre aussi ses routes secondaires (`also`, entrées fusionnées). */
  const isActive = (it: Pick<NavItem, "href" | "also">) =>
    isActiveHref(it.href) || (it.also ?? []).some(isActiveHref);

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
      className="sticky top-0 h-screen shrink-0 z-50 hidden md:flex touch:!hidden flex-col bg-[#0b1018] border-r border-white/[0.07] overflow-hidden"
    >
      {/* Liseré signal — fine colonne dégradée côté contenu */}
      <span aria-hidden className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-brand-500/40 to-transparent" />

      {/* ── Logo + collapse ─────────────────────────────── */}
      <div className={`flex items-center h-[60px] shrink-0 ${rail ? "justify-center px-0" : "justify-between pl-5 pr-3"}`}>
        <Link href="/" className="flex items-center gap-2.5 group select-none" title="Gervi — Accueil">
          <div className="relative flex h-[30px] w-[30px] items-center justify-center text-white transition-transform duration-300 group-hover:scale-110">
            <Logo className="h-[28px] w-[28px]" />
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-[#0b1018] animate-soft-pulse" />
          </div>
          <AnimatePresence initial={false}>
            {!rail && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                className="text-[16px] font-bold tracking-[-0.02em] text-white/90 group-hover:text-white transition-colors whitespace-nowrap"
              >
                Gerv<span className="text-brand-400">i</span>
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
        {!rail && (
          <div className="flex items-center gap-0.5">
            {/* Mode MODIFICATION de la nav (admin/direction) : renommer + déplacer. */}
            {canPreview && (
              <button
                onClick={editingNav ? cancelEditNav : startEditNav}
                title={editingNav ? "Quitter le mode modification (sans enregistrer)" : "Modifier la navigation — renommer les entrées, changer leur zone"}
                aria-pressed={editingNav}
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                  editingNav
                    ? "bg-brand-500/20 text-brand-300 ring-1 ring-brand-500/40"
                    : "text-white/35 hover:text-white/75 hover:bg-white/[0.06]"
                }`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={toggleRail}
              title="Réduire le menu"
              className="h-7 w-7 rounded-lg flex items-center justify-center text-white/35 hover:text-white/75 hover:bg-white/[0.06] transition-colors"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Navigation groupée ─────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2 pt-1 space-y-4">
        {editingNav ? (
          /* ── MODE MODIFICATION : renommer + déplacer (zone/ordre) en place ── */
          <>
          {draft.map((group) => {
            const isSub = !!group.parent;
            const canDelete = !!group.custom && group.rows.length === 0 && !draft.some((g) => g.parent === group.label);
            return (
            <div key={group.label} className={isSub ? "ml-2.5 border-l border-white/10 pl-2 -mt-3" : ""}>
              {/* En-tête de catégorie — GLISSABLE en entier (1er niveau) pour la
                  réordonner. Renommer (créées) passe par le crayon (sinon glisser
                  = bouger le bloc, pas éditer). Réordonner (secours) · + sous-cat · suppr. */}
              {(() => {
                const catEditing = editKey === `cat:${group.label}`;
                const catDraggable = !isSub && !catEditing;
                // Une ENTRÉE glissée peut être déposée sur n'importe quel en-tête
                // (y compris sous-catégorie) → elle est ajoutée EN BAS de cette
                // catégorie. Une CATÉGORIE glissée s'échange avec un autre en-tête
                // de 1er niveau. Surbrillance simple (cible possible) / double (survol).
                const catSwapping = !isSub && !!dragCat && dragCat !== group.label;
                const catRowTarget = !!dragHref;   // une entrée cherche une catégorie d'accueil
                const rowIntoHover = overCat === `into:${group.label}`;
                return (
              <div
                draggable={catDraggable}
                onDragStart={catDraggable ? (e) => { e.dataTransfer.effectAllowed = "move"; setDragCat(group.label); } : undefined}
                onDragEnd={endCatDrag}
                onDragOver={(e) => {
                  if (catSwapping) { e.preventDefault(); setOverCat(group.label); }
                  else if (dragHref) { e.preventDefault(); setOverCat(`into:${group.label}`); }
                }}
                onDrop={(e) => {
                  if (catSwapping) { e.preventDefault(); swapCat(group.label); }
                  else if (dragHref) { e.preventDefault(); dropBefore(group.label, null); setOverCat(null); }
                  else endCatDrag();
                }}
                className={`group/cat px-1 py-0.5 mb-1.5 flex items-center gap-0.5 rounded-md transition-all duration-150 ${
                  catDraggable ? "cursor-grab active:cursor-grabbing" : ""
                } ${dragCat === group.label ? "opacity-40 ring-1 ring-brand-400/50" : ""} ${
                  catSwapping
                    ? (overCat === group.label ? "ring-2 ring-brand-400 bg-brand-500/15" : "ring-1 ring-brand-400/40")
                    : catRowTarget
                      ? (rowIntoHover ? "ring-2 ring-emerald-400 bg-emerald-500/15" : "ring-1 ring-emerald-400/40")
                      : ""
                }`}
              >
                {isSub
                  ? <CornerDownRight className="h-3 w-3 shrink-0 text-white/30" />
                  : <GripVertical className="h-3.5 w-3.5 shrink-0 text-white/25 group-hover/cat:text-white/50 transition-colors" />}
                {group.custom && catEditing ? (
                  <input
                    autoFocus
                    value={catDraftLabel}
                    onChange={(e) => setCatDraftLabel(e.target.value)}
                    onBlur={() => commitEditCat(group.label)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitEditCat(group.label); else if (e.key === "Escape") setEditKey(null); }}
                    aria-label={`Nom de la catégorie ${group.label}`}
                    className="min-w-0 flex-1 h-6 rounded-md border border-white/15 bg-white/[0.06] px-1.5 text-[10px] uppercase tracking-[0.1em] font-bold text-white/80 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                ) : (
                  <span className={`min-w-0 flex-1 truncate uppercase font-bold ${isSub ? "text-[9px] tracking-[0.14em] text-white/50" : "text-[9.5px] tracking-[0.18em] text-white/55"}`}>
                    {group.label}
                  </span>
                )}
                {group.custom && (
                  <button type="button" draggable={false} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => (catEditing ? commitEditCat(group.label) : startEditCat(group.label))}
                    title={catEditing ? "Valider le nom" : "Renommer la catégorie"}
                    className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/[0.06] transition-colors">
                    {catEditing ? <Check className="h-3 w-3 text-emerald-400" /> : <Pencil className="h-3 w-3" />}
                  </button>
                )}
                <button type="button" onClick={() => shiftCategory(group.label, -1)} title="Monter la catégorie"
                  className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/[0.06] transition-colors">
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => shiftCategory(group.label, 1)} title="Descendre la catégorie"
                  className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/[0.06] transition-colors">
                  <ChevronDown className="h-3 w-3" />
                </button>
                {!isSub && (
                  <button type="button" onClick={() => addSubCategory(group.label)} title="Ajouter une sous-catégorie"
                    className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-white/30 hover:text-brand-300 hover:bg-white/[0.06] transition-colors">
                    <Plus className="h-3 w-3" />
                  </button>
                )}
                {group.custom && (
                  <button type="button" onClick={() => removeCategory(group.label)} disabled={!canDelete}
                    title={canDelete ? "Supprimer la catégorie" : "Videz la catégorie (et ses sous-catégories) pour la supprimer"}
                    className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-white/30 hover:text-rose-300 hover:bg-white/[0.06] transition-colors disabled:opacity-25 disabled:hover:text-white/30 disabled:hover:bg-transparent">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
                );
              })()}
              <ul className="space-y-1">
                {group.rows.map((row) => {
                  const Icon = ICON_BY_HREF.get(row.href) ?? Radio;
                  const dragging = dragHref === row.href;
                  const rowEditing = editKey === `row:${row.href}`;
                  // Échange : au pick-up, toutes les autres entrées s'allument
                  // (simple) ; celle survolée s'allume plus fort (double).
                  const rowHovered = overKey === `row:${row.href}` && !!dragHref && !dragging;
                  const rowCandidate = !!dragHref && !dragging && !rowEditing;
                  return (
                      <li
                        key={row.href}
                        draggable={!rowEditing}
                        onDragStart={rowEditing ? undefined : (e) => { e.dataTransfer.effectAllowed = "move"; setDragHref(row.href); }}
                        onDragEnd={endDrag}
                        onDragOver={(e) => {
                          if (dragHref && !dragging) { e.preventDefault(); setOverKey(`row:${row.href}`); }
                        }}
                        onDrop={(e) => { e.preventDefault(); dropOnRow(row.href); }}
                        title={rowEditing ? undefined : "Glisser · déposer sur une autre entrée pour les échanger"}
                        className={`group/row flex items-center gap-1.5 rounded-lg pr-1 min-h-[38px] transition-all duration-150 ${
                          rowEditing ? "" : "cursor-grab active:cursor-grabbing"
                        } ${dragging ? "opacity-40 ring-1 ring-brand-400/50" : ""} ${
                          rowHovered ? "ring-2 ring-brand-400 bg-brand-500/15"
                          : rowCandidate ? "ring-1 ring-brand-400/40" : "hover:bg-white/[0.05]"
                        }`}
                      >
                        {/* Poignée VISUELLE — toute la ligne glisse (« prendre toute la case »). */}
                        <span className="shrink-0 h-8 w-3.5 flex items-center justify-center text-white/25 group-hover/row:text-white/50 transition-colors">
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <Icon className="h-[18px] w-[18px] shrink-0 text-white/50" strokeWidth={1.8} />
                        {rowEditing ? (
                          <input
                            autoFocus
                            value={row.label}
                            onChange={(e) => renameDraft(row.href, e.target.value)}
                            onBlur={() => setEditKey(null)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditKey(null); }}
                            placeholder={row.defaultLabel}
                            aria-label={`Libellé de ${row.defaultLabel}`}
                            className="min-w-0 flex-1 h-8 rounded-lg border border-white/15 bg-white/[0.06] px-2 text-[12px] text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate py-1.5 text-[12px] text-white/85">
                            {row.label.trim() || row.defaultLabel}
                          </span>
                        )}
                        <button type="button" draggable={false} onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setEditKey(rowEditing ? null : `row:${row.href}`)}
                          title={rowEditing ? "Valider" : "Renommer"}
                          aria-label={`Renommer ${row.defaultLabel}`}
                          className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/[0.06] transition-colors">
                          {rowEditing ? <Check className="h-3 w-3 text-emerald-400" /> : <Pencil className="h-3 w-3" />}
                        </button>
                      </li>
                  );
                })}
                {group.rows.length === 0 && (
                  <li className={`px-2 py-1 text-[11px] italic transition-colors ${dragHref ? "text-brand-300" : "text-white/35"}`}>
                    {dragHref ? "Dépose sur l'en-tête pour ajouter ici." : "Zone vide — glisse une entrée sur l'en-tête de cette catégorie."}
                  </li>
                )}
              </ul>
            </div>
            );
          })}
          {/* ＋ Créer une catégorie de 1er niveau — sert AUSSI de zone de dépôt
              « fin de liste » quand on glisse une catégorie. */}
          <button
            type="button"
            onClick={addCategory}
            onDragOver={(e) => { if (dragCat) { e.preventDefault(); setOverCat("__end__"); } }}
            onDrop={(e) => { if (dragCat) { e.preventDefault(); dropCatBefore(null); } }}
            title="Créer une nouvelle catégorie"
            className={`w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed text-[12px] font-semibold transition-colors ${
              overCat === "__end__" && dragCat
                ? "border-brand-400 bg-brand-500/10 text-white"
                : "border-white/20 text-white/60 hover:text-white hover:border-brand-400/60 hover:bg-white/[0.04]"
            }`}
          >
            <FolderPlus className="h-3.5 w-3.5" /> Nouvelle catégorie
          </button>
          </>
        ) : (
        groups.map((group) => {
          // Aperçu « voir comme » : on masque les entrées hors périmètre du rôle
          // prévisualisé (préparateur = ses 2 écrans). Sans aperçu : tout visible.
          // Une catégorie SANS entrée directe mais avec des sous-catégories reste
          // affichée (en-tête seul) — applyNavConfig ne la garde que dans ce cas.
          const headerOnly = group.label !== null && group.items.length === 0;
          const items = group.items.filter((it) => navAllowedForPreview(it.href, previewRole));
          if (items.length === 0 && !headerOnly) return null;
          const isSub = !!group.parent;
          const collapsible = !!group.collapsible && !rail;
          const hasActive = items.some((it) => isActive(it));
          // Replié par défaut ; s'ouvre seul si la page active est dedans.
          const open = !collapsible || (group.label ? openGroups[group.label] : false) || hasActive;
          return (
          <div key={group.label ?? "accueil"} className={isSub && !rail ? "ml-3 border-l border-white/[0.08] pl-2 -mt-2" : ""}>
            {group.label !== null && (rail ? (
              <div className="mx-2 mb-2 h-px bg-white/[0.07]" />
            ) : collapsible ? (
              <button
                type="button"
                onClick={() => group.label && toggleGroup(group.label)}
                aria-expanded={open}
                className="w-full px-2 mb-1.5 flex items-center justify-between text-[9.5px] uppercase tracking-[0.18em] font-bold text-white/55 hover:text-white/75 transition-colors"
              >
                <span className="whitespace-nowrap">{group.label}</span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
              </button>
            ) : isSub ? (
              <p className="px-2 mb-1 flex items-center gap-1 text-[8.5px] uppercase tracking-[0.14em] font-bold text-white/45 whitespace-nowrap">
                <CornerDownRight className="h-2.5 w-2.5 shrink-0 text-white/30" /> {group.label}
              </p>
            ) : (
              <p className="px-2 mb-1.5 text-[9.5px] uppercase tracking-[0.18em] font-bold text-white/55 whitespace-nowrap">
                {group.label}
              </p>
            ))}
            {open && items.length > 0 && (
            <ul className="space-y-0.5">
              {items.map((it) => {
                const { href, label, icon: Icon, badge } = it;
                const active = isActive(it);
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
                        {/* Pastille de comptage — vacillement léger (animate-badge-wobble). */}
                        {badge && badgeCount > 0 && (
                          <span className={`animate-badge-wobble absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center ring-2 ring-[#0b1018] ${BADGE_STYLE[badge]}`}>
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
        })
        )}
      </nav>

      {/* ── Actions du mode MODIFICATION (Enregistrer / Annuler / Réinitialiser) ── */}
      {editingNav && (
        <div className="shrink-0 border-t border-white/[0.07] px-3 py-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => saveNav(fromNavEditState(draft), "Navigation enregistrée")}
            disabled={savingNav}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[12.5px] font-semibold disabled:opacity-60 transition-colors"
          >
            {savingNav ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
            Enregistrer
          </button>
          <button
            type="button"
            onClick={cancelEditNav}
            disabled={savingNav}
            className="inline-flex items-center justify-center h-9 px-2.5 rounded-lg border border-white/15 text-[12.5px] font-medium text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => saveNav({ items: {}, categories: [] }, "Navigation réinitialisée (libellés et zones d'origine)")}
            disabled={savingNav}
            title="Revenir aux libellés et emplacements d'origine"
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-white/15 text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Footer système ─────────────────────────────── */}
      <div className="shrink-0 border-t border-white/[0.07] px-3 py-3 space-y-2.5">
        {/* « Voir comme » a été déplacé dans Effectifs (par membre + vue réelle).
            En aperçu actif, un retour rapide « Vue réelle » reste ici pour ne
            jamais rester bloqué dans un aperçu restreint. */}
        {!rail && previewRole && (
          <button
            type="button"
            onClick={() => setPreviewRole(null)}
            title="Quitter l'aperçu et revenir à la vue réelle"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 h-9 text-[12.5px] font-medium bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/25 transition-colors"
          >
            <Eye className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">Aperçu : {PREVIEW_ROLE_LABELS[previewRole]}</span>
            <span className="ml-auto text-[11px] font-semibold underline underline-offset-2">Vue réelle</span>
          </button>
        )}

        {/* Bascule SAP prod/test — masquée en rail (badge trop large) */}
        {!rail && <SapEnvSwitch />}

        <div className={`flex items-center ${rail ? "flex-col gap-1.5" : "gap-1"}`}>
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
