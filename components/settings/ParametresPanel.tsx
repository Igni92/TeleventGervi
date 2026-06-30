"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  Moon, Sun, Palette, LayoutList, Sparkles, BadgePercent, Check, Wand2, Database, Contrast, Tags, ChevronRight, CalendarClock,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ShelfLifePanel } from "@/components/settings/ShelfLifePanel";
import { ClientImportButton } from "@/components/clients/ClientImportButton";
import { ResyncButton } from "@/components/admin/ResyncButton";
import { ProductsSyncButton } from "@/components/admin/ProductsSyncButton";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";
import {
  SETTING_KEYS, readSetting, writeSetting, onSettingChange,
  hoverContrastKey, applyHoverContrast, HOVER_CONTRAST_DEFAULT,
} from "@/components/settings/app-settings";

/**
 * Panneau « Paramètres » — CONSOLIDE les réglages d'affichage jusqu'ici dispersés
 * (thème, colorimétrie, densité, animations, bandeau promo) sur une page dédiée.
 *
 * Persistance : 100 % via le mécanisme localStorage existant —
 *   - thème clair/sombre  → ThemeProvider (clé `tv-theme`)
 *   - colorimétrie        → `televent-theme` + attribut data-theme (logique
 *                           reprise de ColorimetrieSwitcher)
 *   - densité / animations / promos → writeSetting (SETTING_KEYS)
 * Tous les consommateurs (Console Écran 2, PromoBanner, AmbientBackground)
 * réagissent à chaud via onSettingChange / l'attribut data-theme.
 */

/* ── Brique réutilisable : groupe de boutons segmentés (DA PilotageScreen2) ── */

interface SegOption<T extends string> {
  id: T;
  label: string;
  hint?: string;
  swatch?: string;
  icon?: React.ReactNode;
}

function SegmentToggle<T extends string>({
  value, onChange, options, ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-lg flex-wrap"
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            title={o.hint}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 h-8 text-[12.5px] font-semibold tracking-tight rounded-md transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.swatch && (
              <span
                className="h-3 w-3 rounded-full ring-1 ring-black/10 dark:ring-white/15 shrink-0"
                style={{ background: o.swatch }}
              />
            )}
            {o.icon}
            {o.label}
            {active && <Check className="h-3 w-3 ml-0.5 text-brand-500" />}
          </button>
        );
      })}
    </div>
  );
}

/** Ligne « libellé + description + contrôle » dans une carte de réglage. */
function SettingRow({
  title, desc, children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-foreground">{title}</p>
        {desc && <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ── Constantes (alignées sur les composants d'origine) ─────────────────── */

const COLORIMETRIE: SegOption<"or" | "agrume" | "fraise">[] = [
  { id: "or",     label: "Or",     hint: "Classique",        swatch: "#facc15" },
  { id: "agrume", label: "Agrume", hint: "Peps · conseillé", swatch: "#f97316" },
  { id: "fraise", label: "Fraise", hint: "Peps max",         swatch: "#f43f5e" },
];

const DENSITES: SegOption<"compact" | "normal" | "aere">[] = [
  { id: "compact", label: "Compact", hint: "Plus de lignes visibles" },
  { id: "normal",  label: "Normal",  hint: "Équilibré (défaut)" },
  { id: "aere",    label: "Aéré",    hint: "Plus d'espace, lecture confort" },
];

const ANIMATIONS: SegOption<"auto" | "on" | "off">[] = [
  { id: "auto", label: "Auto", hint: "Suit le réglage système (accessibilité)" },
  { id: "on",   label: "Activées", hint: "Toujours animer" },
  { id: "off",  label: "Désactivées", hint: "Fond et transitions figés" },
];

const ONOFF: SegOption<"on" | "off">[] = [
  { id: "on",  label: "Activé" },
  { id: "off", label: "Désactivé" },
];

type ColorId = (typeof COLORIMETRIE)[number]["id"];

type DensityId = (typeof DENSITES)[number]["id"];

/** Applique la colorimétrie (même logique que ColorimetrieSwitcher). */
function applyColorimetrie(id: ColorId) {
  try { localStorage.setItem(SETTING_KEYS.colorimetrie, id); } catch { /* ignore */ }
  if (id === "or") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", id);
}

/** Applique la densité GLOBALE → attribut data-density sur <html> (cf. globals.css). */
function applyDensity(id: DensityId) {
  if (id === "normal") document.documentElement.removeAttribute("data-density");
  else document.documentElement.setAttribute("data-density", id);
}

export function ParametresPanel({ admin = false, userKey = null }: { admin?: boolean; userKey?: string | null }) {
  const { theme, toggleTheme } = useTheme();
  const systemReduce = useReducedMotion();

  const [colorimetrie, setColorimetrie] = useState<ColorId>("or");
  const [densite, setDensite] = useState<DensityId>("normal");
  const [animations, setAnimations] = useState<"auto" | "on" | "off">("auto");
  const [promoAnim, setPromoAnim] = useState<"on" | "off">("on");
  const [promoNotifs, setPromoNotifs] = useState<"on" | "off">("on");
  // Contraste de survol — PROPRE à l'utilisateur connecté (clé suffixée).
  const [contrast, setContrast] = useState<number>(HOVER_CONTRAST_DEFAULT);
  const [contrastSet, setContrastSet] = useState<boolean>(false);

  // Hydratation depuis le stockage local + abonnement aux changements (autres
  // onglets / autres widgets qui écriraient les mêmes clés).
  useEffect(() => {
    const fromAttr = document.documentElement.getAttribute("data-theme");
    const savedColor = (fromAttr || readSetting(SETTING_KEYS.colorimetrie, "or")) as ColorId;
    setColorimetrie(COLORIMETRIE.some((c) => c.id === savedColor) ? savedColor : "or");

    const d = readSetting(SETTING_KEYS.density, "normal");
    const dv = (["compact", "normal", "aere"].includes(d) ? d : "normal") as DensityId;
    setDensite(dv);
    applyDensity(dv); // resynchronise l'attribut au cas où (idempotent)

    const a = readSetting(SETTING_KEYS.animations, "auto");
    setAnimations((["auto", "on", "off"].includes(a) ? a : "auto") as typeof animations);

    setPromoAnim(readSetting(SETTING_KEYS.promoBannerAnim, "on") === "off" ? "off" : "on");
    setPromoNotifs(readSetting(SETTING_KEYS.promoNotifs, "on") === "off" ? "off" : "on");

    // Contraste de survol propre à l'utilisateur (valeur vide = jamais réglé).
    const cRaw = readSetting(hoverContrastKey(userKey), "");
    if (cRaw !== "" && Number.isFinite(Number(cRaw))) {
      const cv = Math.max(0, Math.min(100, Number(cRaw)));
      setContrast(cv); setContrastSet(true);
    } else {
      setContrast(HOVER_CONTRAST_DEFAULT); setContrastSet(false);
    }

    return onSettingChange((key, value) => {
      if (key === SETTING_KEYS.colorimetrie && value) setColorimetrie(value as ColorId);
      if (key === SETTING_KEYS.density && value) { setDensite(value as DensityId); applyDensity(value as DensityId); }
      if (key === SETTING_KEYS.animations && value) setAnimations(value as typeof animations);
      if (key === SETTING_KEYS.promoBannerAnim) setPromoAnim(value === "off" ? "off" : "on");
      if (key === SETTING_KEYS.promoNotifs) setPromoNotifs(value === "off" ? "off" : "on");
      if (key === hoverContrastKey(userKey)) {
        if (value && Number.isFinite(Number(value))) { setContrast(Math.max(0, Math.min(100, Number(value)))); setContrastSet(true); }
        else { setContrast(HOVER_CONTRAST_DEFAULT); setContrastSet(false); }
      }
    });
  }, [userKey]);

  const onColorimetrie = (id: ColorId) => {
    setColorimetrie(id);
    applyColorimetrie(id);
    // Notifie l'onglet courant (le storage natif couvre les autres onglets).
    writeSetting(SETTING_KEYS.colorimetrie, id);
  };

  /** Réglage du contraste de survol : applique à chaud + mémorise (par user). */
  const onContrast = (pct: number) => {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    setContrast(v); setContrastSet(true);
    applyHoverContrast(v);
    writeSetting(hoverContrastKey(userKey), String(v));
  };

  const effectiveAnim =
    animations === "off" ? "Figées"
    : animations === "on" ? "Animées"
    : systemReduce ? "Réduites (système)" : "Animées (système)";

  return (
    <div className="space-y-5 max-w-3xl">
      {/* 1 ── Thème clair / sombre ─────────────────────────────────── */}
      <SurfaceCard accent="brand" title="Thème" icon={<Moon className="h-3.5 w-3.5" />}>
        <SettingRow
          title="Apparence"
          desc="Mode sombre (anthracite + accent) recommandé pour l'usage deux écrans en télévente."
        >
          <SegmentToggle
            ariaLabel="Thème clair ou sombre"
            value={theme}
            onChange={(v) => { if (v !== theme) toggleTheme(); }}
            options={[
              { id: "light", label: "Clair", icon: <Sun className="h-3.5 w-3.5" /> },
              { id: "dark",  label: "Sombre", icon: <Moon className="h-3.5 w-3.5" /> },
            ]}
          />
        </SettingRow>
      </SurfaceCard>

      {/* 2 ── Colorimétrie ─────────────────────────────────────────── */}
      <SurfaceCard accent="amber" title="Colorimétrie" icon={<Palette className="h-3.5 w-3.5" />}>
        <SettingRow
          title="Accent de l'application"
          desc="Change la couleur d'accent (boutons, liens, surbrillances). Le fond anthracite et les couleurs d'alerte ne bougent pas."
        >
          <SegmentToggle
            ariaLabel="Colorimétrie de l'application"
            value={colorimetrie}
            onChange={onColorimetrie}
            options={COLORIMETRIE}
          />
        </SettingRow>
      </SurfaceCard>

      {/* 3 ── Densité ──────────────────────────────────────────────── */}
      <SurfaceCard accent="sky" title="Densité" icon={<LayoutList className="h-3.5 w-3.5" />}>
        <SettingRow
          title="Densité de l'affichage"
          desc="Compacité générale de toute l'application (espacements des listes, cartes, tableaux). Compact = plus d'informations à l'écran, Aéré = lecture plus confortable."
        >
          <SegmentToggle
            ariaLabel="Densité d'affichage de l'application"
            value={densite}
            onChange={(v) => { setDensite(v); applyDensity(v); writeSetting(SETTING_KEYS.density, v); }}
            options={DENSITES}
          />
        </SettingRow>
      </SurfaceCard>

      {/* 3 bis ── Contraste de survol (propre à l'utilisateur) ──────── */}
      <SurfaceCard accent="sky" title="Contraste de survol" icon={<Contrast className="h-3.5 w-3.5" />}>
        <div className="space-y-4">
          <SettingRow
            title="Surbrillance au survol"
            desc="Intensité de la surbrillance quand le curseur passe d'une ligne à l'autre, partout dans l'application. Réglage propre à votre session — il vous suit, même sur un poste partagé."
          >
            <div className="flex items-center gap-3 min-w-[210px]">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={contrast}
                onChange={(e) => onContrast(Number(e.target.value))}
                aria-label="Contraste de la surbrillance au survol"
                className="w-40 h-1.5 rounded-full appearance-none cursor-pointer bg-secondary accent-brand-500"
              />
              <span className="tnum text-[13px] font-semibold text-foreground w-10 text-right">
                {contrast}%
              </span>
            </div>
          </SettingRow>
          {/* Aperçu : 3 lignes qui réagissent au survol comme le reste de l'app. */}
          <div className="rounded-lg border border-border/60 overflow-hidden">
            {["Survolez-moi pour voir l'effet", "Ligne d'exemple", "Ligne d'exemple"].map((t, i) => (
              <div
                key={i}
                className="px-3 py-2 text-[12.5px] text-foreground/80 hover:bg-secondary transition-colors cursor-default border-b border-border/40 last:border-0"
              >
                {t}
              </div>
            ))}
          </div>
          {contrastSet && (
            <button
              type="button"
              onClick={() => {
                setContrastSet(false);
                setContrast(HOVER_CONTRAST_DEFAULT);
                applyHoverContrast(null);
                writeSetting(hoverContrastKey(userKey), "");
              }}
              className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              Réinitialiser (rendu par défaut)
            </button>
          )}
        </div>
      </SurfaceCard>

      {/* 3 ter ── Marques & logos (page dédiée) ───────────────────── */}
      <SurfaceCard accent="violet" title="Marques & logos" icon={<Tags className="h-3.5 w-3.5" />}>
        <Link
          href="/parametres/marques"
          className="flex items-center justify-between gap-4 -m-1 p-1 rounded-lg hover:bg-secondary/40 transition-colors group"
        >
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground">Logos des marques</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">
              Associe un logo à chaque marque du catalogue. Ils s&apos;affichent dans la console,
              entre le stock et la désignation du produit.
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600 dark:text-brand-400">
            Gérer <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </Link>
      </SurfaceCard>

      {/* Fraîcheur · DLC par défaut — durée de vie (jours) par article. */}
      {admin && (
        <SurfaceCard accent="amber" title="Fraîcheur · DLC par défaut" icon={<CalendarClock className="h-3.5 w-3.5" />}>
          <ShelfLifePanel />
        </SurfaceCard>
      )}

      {/* 4 ── Animations ───────────────────────────────────────────── */}
      <SurfaceCard accent="violet" title="Animations" icon={<Wand2 className="h-3.5 w-3.5" />}>
        <SettingRow
          title="Animations d'ambiance"
          desc={`Fond animé (aurora, anneaux radar) et transitions. « Auto » respecte le réglage d'accessibilité du système — actuellement : ${effectiveAnim}.`}
        >
          <SegmentToggle
            ariaLabel="Niveau d'animation"
            value={animations}
            onChange={(v) => { setAnimations(v); writeSetting(SETTING_KEYS.animations, v); }}
            options={ANIMATIONS}
          />
        </SettingRow>
      </SurfaceCard>

      {/* 5 ── Bandeau promo ────────────────────────────────────────── */}
      <SurfaceCard accent="rose" title="Bandeau promotions" icon={<BadgePercent className="h-3.5 w-3.5" />}>
        <div className="space-y-4">
          <SettingRow
            title="Rotation automatique"
            desc="Fait défiler les promotions du bandeau toutes les ~6 s. Désactivé : navigation manuelle uniquement (le bandeau reste visible)."
          >
            <SegmentToggle
              ariaLabel="Animation du bandeau promotions"
              value={promoAnim}
              onChange={(v) => { setPromoAnim(v); writeSetting(SETTING_KEYS.promoBannerAnim, v); }}
              options={ONOFF}
            />
          </SettingRow>
          <div className="h-px bg-border/60" />
          <SettingRow
            title="Modale « Nouvelles promotions »"
            desc="Affiche au démarrage les promotions lancées depuis ta dernière visite. Désactivé : aucune fenêtre, le bandeau reste actif."
          >
            <SegmentToggle
              ariaLabel="Notifications des nouvelles promotions"
              value={promoNotifs}
              onChange={(v) => { setPromoNotifs(v); writeSetting(SETTING_KEYS.promoNotifs, v); }}
              options={ONOFF}
            />
          </SettingRow>
        </div>
      </SurfaceCard>

      {/* 6 ── Données · SAP (admin) — HUB unique de synchronisation ──
            Regroupe ici TOUTES les actions données (avant dispersées sur les
            pages Clients / Plan d'appel) : clients, miroir stats, produits/stock.
            Réservé aux administrateurs ; à lancer ponctuellement. */}
      {admin && (
        <SurfaceCard accent="sky" title="Données · SAP" icon={<Database className="h-3.5 w-3.5" />}>
          <p className="text-[12px] text-muted-foreground -mt-1 mb-1 max-w-xl">
            Centre de synchronisation (administrateurs). Lectures épinglées sur la base réelle —
            à lancer ponctuellement, pas en continu.
          </p>
          <div className="flex flex-col divide-y divide-border/50">
            <div className="flex flex-col gap-2 py-3 first:pt-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-foreground">Clients SAP</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">
                  Base clients + localisation (ville / CP / pays, pour la carte). « Actualiser »
                  n&apos;efface rien ; « Réimport complet » repart de zéro.
                </p>
              </div>
              <div className="shrink-0"><ClientImportButton /></div>
            </div>

            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-foreground">Données stats (miroir comptable)</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">
                  Factures, avoirs, commandes et fournisseurs — alimente le pilotage et les marges.
                  Reconstruction complète : à relancer de temps en temps.
                </p>
              </div>
              <div className="shrink-0"><ResyncButton /></div>
            </div>

            <div className="flex flex-col gap-2 py-3 last:pb-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-foreground">Stock &amp; catalogue produits</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">
                  Quantités et infos articles depuis SAP. Le stock « live » de la console se
                  rafraîchit déjà tout seul ; ceci resynchronise le catalogue complet.
                </p>
              </div>
              <div className="shrink-0"><ProductsSyncButton /></div>
            </div>
          </div>
        </SurfaceCard>
      )}

      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground/80 pt-1">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        Ces réglages d&apos;affichage sont propres à ce poste (navigateur) et s&apos;appliquent
        immédiatement, sur tous les onglets ouverts.
      </p>
    </div>
  );
}
