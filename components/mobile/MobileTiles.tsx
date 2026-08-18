"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { navAllowedForRoles } from "@/lib/rolePreview";
import { NAV_GROUPS, NAV_FOOTER, type NavGroup, type NavItem } from "@/lib/navigation";
import { useNavBadges } from "@/lib/useNavBadges";

/**
 * Écran d'accueil MOBILE — un lanceur en tuiles « façon application ».
 * Les tuiles sont DÉRIVÉES de la source de vérité nav (lib/navigation) :
 * une section par groupe, une tuile par entrée — plus de taxonomie parallèle
 * à maintenir. Le groupe « Accueil » est omis (ce lanceur EST l'accueil),
 * les entrées de NAV_FOOTER (Paramètres) ferment la liste.
 */

/** Accent visuel par groupe (barre de titre + dégradé d'icône). */
const ACCENT: Record<string, { bar: string; icon: string }> = {
  televente: { bar: "bg-sky-500", icon: "from-sky-500/20 to-sky-500/5 text-sky-600 dark:text-sky-400" },
  entrepot: { bar: "bg-amber-500", icon: "from-amber-500/20 to-amber-500/5 text-amber-600 dark:text-amber-400" },
  achats: { bar: "bg-orange-500", icon: "from-orange-500/20 to-orange-500/5 text-orange-600 dark:text-orange-400" },
  pilotage: { bar: "bg-emerald-500", icon: "from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  rh: { bar: "bg-violet-500", icon: "from-violet-500/20 to-violet-500/5 text-violet-600 dark:text-violet-400" },
};
/** Accent neutre — groupes inconnus + pied (Paramètres). */
const ACCENT_FALLBACK = { bar: "bg-slate-400", icon: "from-slate-500/15 to-slate-500/5 text-slate-600 dark:text-slate-400" };

const FAV_AXES_KEY = "televent-mobile-fav-axes";

/**
 * FAVORIS des sections du lanceur — préférence PAR APPAREIL (localStorage),
 * clé = key du groupe de nav. Les sections favorites remontent en tête, dans
 * leur ordre d'origine. Chargé côté client (pas de mismatch SSR).
 */
function useFavAxes() {
  const [favs, setFavs] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_AXES_KEY);
      const a = raw ? JSON.parse(raw) : null;
      if (Array.isArray(a)) setFavs(a.filter((x) => typeof x === "string"));
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);
  const toggle = (key: string) =>
    setFavs((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      try { localStorage.setItem(FAV_AXES_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  return { favs, toggle, loaded };
}

/** Sections du lanceur : les groupes de nav (sans « Accueil » — on y est déjà)
 *  + une section de pied pour NAV_FOOTER. */
const SECTIONS: NavGroup[] = [
  ...NAV_GROUPS.filter((g) => g.key !== "accueil"),
  { key: "footer", label: null, items: NAV_FOOTER },
];

export function MobileTiles({ className }: { className?: string }) {
  const { previewRoles } = useRolePreview();
  const { favs, toggle, loaded } = useFavAxes();
  // Pastilles de comptage — source unique (polling + évènement incidents).
  const badges = useNavBadges();

  // Sections favorites en tête (tri stable → ordre d'origine préservé).
  const orderedSections = useMemo(() => {
    if (!loaded || favs.length === 0) return SECTIONS;
    const fav = new Set(favs);
    return [...SECTIONS].sort((a, b) => (fav.has(b.key) ? 1 : 0) - (fav.has(a.key) ? 1 : 0));
  }, [favs, loaded]);

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      {orderedSections.map((section) => {
        // Aperçu « voir comme » : ne montrer que les tuiles du périmètre du rôle.
        const tiles = section.items.filter((t: NavItem) => navAllowedForRoles(t.href, previewRoles));
        if (tiles.length === 0) return null;
        const accent = ACCENT[section.key] ?? ACCENT_FALLBACK;
        const isFav = favs.includes(section.key);
        return (
          <section key={section.key}>
            {section.label !== null && (
              <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
                <span className={`h-6 w-1.5 rounded-full ${accent.bar}`} aria-hidden />
                <h2 className="text-title3 font-semibold text-foreground leading-none">{section.label}</h2>
                {isFav && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-caption2 font-semibold text-amber-600 dark:text-amber-400">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Favori
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggle(section.key)}
                  aria-pressed={isFav}
                  aria-label={isFav ? `Retirer ${section.label} des favoris` : `Mettre ${section.label} en favori`}
                  title={isFav ? "Retirer des favoris" : "Mettre en favori (remonte en haut)"}
                  className={`ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors active:scale-90 ${
                    isFav ? "text-amber-500" : "text-muted-foreground/45 hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <Star className={`h-5 w-5 ${isFav ? "fill-amber-400" : ""}`} strokeWidth={2} />
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {tiles.map((t, idx) => {
                const Icon = t.icon;
                const count = t.badge ? badges[t.badge] ?? 0 : 0;
                // Dernière tuile d'une section au nombre impair → pleine largeur (pas de trou).
                const fillRow = idx === tiles.length - 1 && tiles.length % 2 === 1;
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={`group relative flex flex-col justify-between h-[104px] rounded-2xl border border-border bg-card p-3.5 active:scale-[0.97] transition-transform overflow-hidden ${fillRow ? "col-span-2" : ""}`}
                  >
                    <div className="flex items-start justify-between">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${accent.icon}`}>
                        <Icon className="h-6 w-6" strokeWidth={1.9} />
                      </span>
                      {count > 0 && (
                        <span className="inline-flex min-w-[22px] h-[22px] px-1.5 items-center justify-center rounded-full bg-amber-500 text-caption font-bold text-amber-950">
                          {count > 9 ? "9+" : count}
                        </span>
                      )}
                    </div>
                    <p className="text-callout font-semibold text-foreground leading-tight">{t.label}</p>
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
