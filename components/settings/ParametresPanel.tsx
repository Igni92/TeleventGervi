"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  Moon, Sun, ZoomIn, Check, Database, Contrast, Tags, ChevronRight, CalendarClock,
  Palette, Glasses, MonitorCog, MousePointerClick, Wand2, BadgePercent, Rows3,
  ShieldAlert,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ShelfLifePanel } from "@/components/settings/ShelfLifePanel";
import { SafeguardsPanel } from "@/components/settings/SafeguardsPanel";
import { ClientImportButton } from "@/components/clients/ClientImportButton";
import { MirrorBackfillPanel } from "@/components/admin/MirrorBackfillPanel";
import { ProductsSyncButton } from "@/components/admin/ProductsSyncButton";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";
import {
  SETTING_KEYS, readSetting, writeSetting, onSettingChange,
  hoverContrastKey, applyHoverContrast, HOVER_CONTRAST_DEFAULT, HOVER_CONTRAST_MAX,
  UI_ZOOM_VALUES, UI_ZOOM_DEFAULT, applyUiZoom, type UiZoomValue,
} from "@/components/settings/app-settings";

/**
 * Panneau « Paramètres » — refonte : QUATRE sections nettes au lieu d'une pile
 * de cartes, avec sommaire ancré (scroll-spy) sur desktop.
 *
 *   1. Apparence          — thème, animations, étincelles au clic
 *   2. Confort de lecture — zoom, densité, contraste de survol
 *   3. Console & catalogue — logos de marque, bandeau promotions
 *   4. Administration     — DLC par défaut, synchronisations SAP (admin)
 *
 * Persistance inchangée : localStorage via writeSetting (SETTING_KEYS) +
 * ThemeProvider (`tv-theme`). Tous les consommateurs réagissent à chaud.
 */

/* ── Brique : groupe de boutons segmentés (DA PilotageScreen2) ── */

interface SegOption<T extends string> {
  id: T;
  label: string;
  hint?: string;
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
            {o.icon}
            {o.label}
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
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-foreground">{title}</p>
        {desc && <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Puce on/off compacte (zones de logos) — un clic bascule. */
function ZoneChip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors",
        on
          ? "bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-500/40"
          : "bg-secondary/60 text-muted-foreground ring-1 ring-inset ring-border hover:text-foreground",
      )}
    >
      <Check className={cn("h-3.5 w-3.5 transition-opacity", on ? "opacity-100" : "opacity-25")} />
      {label}
    </button>
  );
}

/* ── Constantes ─────────────────────────────────────────────── */

const ZOOMS: SegOption<UiZoomValue>[] = [
  { id: "100", label: "Normale",     hint: "Taille standard (défaut)" },
  { id: "110", label: "Grande",      hint: "+10 %" },
  { id: "125", label: "Très grande", hint: "+25 %" },
  { id: "140", label: "Maximale",    hint: "+40 %" },
];

const DENSITES: SegOption<"compact" | "normal" | "aere">[] = [
  { id: "compact", label: "Compact", hint: "Plus de lignes visibles" },
  { id: "normal",  label: "Normal",  hint: "Équilibré (défaut)" },
  { id: "aere",    label: "Aéré",    hint: "Plus d'espace" },
];

const ANIMATIONS: SegOption<"auto" | "on" | "off">[] = [
  { id: "auto", label: "Auto", hint: "Suit le réglage système (accessibilité)" },
  { id: "on",   label: "Activées" },
  { id: "off",  label: "Désactivées" },
];

const ONOFF: SegOption<"on" | "off">[] = [
  { id: "on",  label: "Activé" },
  { id: "off", label: "Désactivé" },
];

/** Effet au clic — choix de l'animation (ou aucune). */
type ClickFx = "sparks" | "ripple" | "rain" | "off";
const CLICK_FX: SegOption<ClickFx>[] = [
  { id: "sparks", label: "Étincelles", hint: "Éclat de particules or" },
  { id: "ripple", label: "Onde d'eau", hint: "Anneaux concentriques" },
  { id: "rain",   label: "Cascade",    hint: "Gouttes qui tombent jusqu'en bas" },
  { id: "off",    label: "Aucun" },
];
/** Normalise la valeur stockée (« on » historique → « sparks »). */
function readClickFx(v: string): ClickFx {
  return v === "off" ? "off" : v === "ripple" ? "ripple" : v === "rain" ? "rain" : "sparks";
}

type DensityId = (typeof DENSITES)[number]["id"];

/** Applique la densité GLOBALE → attribut data-density sur <html> (cf. globals.css). */
function applyDensity(id: DensityId) {
  if (id === "normal") document.documentElement.removeAttribute("data-density");
  else document.documentElement.setAttribute("data-density", id);
}

/* ── Sommaire ancré (desktop) avec scroll-spy ──────────────── */

interface SectionDef { id: string; label: string; icon: React.ReactNode; adminOnly?: boolean }

const SECTIONS: SectionDef[] = [
  { id: "apparence", label: "Apparence",           icon: <Palette className="h-3.5 w-3.5" /> },
  { id: "lecture",   label: "Confort de lecture",  icon: <Glasses className="h-3.5 w-3.5" /> },
  { id: "console",   label: "Console & catalogue", icon: <MonitorCog className="h-3.5 w-3.5" /> },
  { id: "admin",     label: "Administration",      icon: <Database className="h-3.5 w-3.5" />, adminOnly: true },
];

function SectionNav({ sections }: { sections: SectionDef[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        // La section la plus haute actuellement visible gagne.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Sections des paramètres" className="hidden lg:block sticky top-6 self-start w-48 shrink-0">
      <ul className="space-y-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold transition-colors",
                active === s.id
                  ? "bg-brand-500/12 text-brand-700 dark:text-brand-300 shadow-[inset_2px_0_0_0_hsl(var(--brand-500))]"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              {s.icon}
              {s.label}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 px-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
        Réglages propres à ce poste, appliqués immédiatement sur tous les onglets.
      </p>
    </nav>
  );
}

/* ── Panneau ────────────────────────────────────────────────── */

export function ParametresPanel({ admin = false, userKey = null }: { admin?: boolean; userKey?: string | null }) {
  const { theme, toggleTheme } = useTheme();
  const systemReduce = useReducedMotion();

  const [zoom, setZoom] = useState<UiZoomValue>(UI_ZOOM_DEFAULT);
  const [densite, setDensite] = useState<DensityId>("normal");
  const [animations, setAnimations] = useState<"auto" | "on" | "off">("auto");
  const [clickFx, setClickFx] = useState<ClickFx>("sparks");
  const [promoAnim, setPromoAnim] = useState<"on" | "off">("on");
  const [promoNotifs, setPromoNotifs] = useState<"on" | "off">("on");
  // Logos de marque — réglables indépendamment par zone.
  const [logoConsole, setLogoConsole] = useState<"on" | "off">("on");
  const [logoLivraison, setLogoLivraison] = useState<"on" | "off">("on");
  const [logoInventaire, setLogoInventaire] = useState<"on" | "off">("on");
  // Contraste de survol — PROPRE à l'utilisateur connecté (clé suffixée).
  const [contrast, setContrast] = useState<number>(HOVER_CONTRAST_DEFAULT);
  const [contrastSet, setContrastSet] = useState<boolean>(false);

  // Hydratation depuis le stockage local + abonnement aux changements (autres
  // onglets / autres widgets qui écriraient les mêmes clés).
  useEffect(() => {
    const z = readSetting(SETTING_KEYS.uiZoom, UI_ZOOM_DEFAULT);
    const zv = (UI_ZOOM_VALUES.includes(z as UiZoomValue) ? z : UI_ZOOM_DEFAULT) as UiZoomValue;
    setZoom(zv);
    applyUiZoom(zv); // resynchronise --app-zoom au cas où (idempotent)

    const d = readSetting(SETTING_KEYS.density, "normal");
    const dv = (["compact", "normal", "aere"].includes(d) ? d : "normal") as DensityId;
    setDensite(dv);
    applyDensity(dv); // resynchronise l'attribut au cas où (idempotent)

    const a = readSetting(SETTING_KEYS.animations, "auto");
    setAnimations((["auto", "on", "off"].includes(a) ? a : "auto") as typeof animations);

    setClickFx(readClickFx(readSetting(SETTING_KEYS.clickSparks, "sparks")));
    setPromoAnim(readSetting(SETTING_KEYS.promoBannerAnim, "on") === "off" ? "off" : "on");
    setPromoNotifs(readSetting(SETTING_KEYS.promoNotifs, "on") === "off" ? "off" : "on");
    setLogoConsole(readSetting(SETTING_KEYS.brandLogosConsole, "on") === "off" ? "off" : "on");
    setLogoLivraison(readSetting(SETTING_KEYS.brandLogosLivraison, "on") === "off" ? "off" : "on");
    setLogoInventaire(readSetting(SETTING_KEYS.brandLogosInventaire, "on") === "off" ? "off" : "on");

    // Contraste de survol propre à l'utilisateur (valeur vide = jamais réglé).
    const cRaw = readSetting(hoverContrastKey(userKey), "");
    if (cRaw !== "" && Number.isFinite(Number(cRaw))) {
      const cv = Math.max(0, Math.min(100, Number(cRaw)));
      setContrast(cv); setContrastSet(true);
    } else {
      setContrast(HOVER_CONTRAST_DEFAULT); setContrastSet(false);
    }

    return onSettingChange((key, value) => {
      if (key === SETTING_KEYS.uiZoom && value) { setZoom(value as UiZoomValue); applyUiZoom(value as UiZoomValue); }
      if (key === SETTING_KEYS.density && value) { setDensite(value as DensityId); applyDensity(value as DensityId); }
      if (key === SETTING_KEYS.animations && value) setAnimations(value as typeof animations);
      if (key === SETTING_KEYS.clickSparks) setClickFx(readClickFx(value ?? "sparks"));
      if (key === SETTING_KEYS.promoBannerAnim) setPromoAnim(value === "off" ? "off" : "on");
      if (key === SETTING_KEYS.promoNotifs) setPromoNotifs(value === "off" ? "off" : "on");
      if (key === SETTING_KEYS.brandLogosConsole) setLogoConsole(value === "off" ? "off" : "on");
      if (key === SETTING_KEYS.brandLogosLivraison) setLogoLivraison(value === "off" ? "off" : "on");
      if (key === SETTING_KEYS.brandLogosInventaire) setLogoInventaire(value === "off" ? "off" : "on");
      if (key === hoverContrastKey(userKey)) {
        if (value && Number.isFinite(Number(value))) { setContrast(Math.max(0, Math.min(100, Number(value)))); setContrastSet(true); }
        else { setContrast(HOVER_CONTRAST_DEFAULT); setContrastSet(false); }
      }
    });
  }, [userKey]);

  const onZoom = (v: UiZoomValue) => {
    setZoom(v);
    applyUiZoom(v);
    writeSetting(SETTING_KEYS.uiZoom, v);
  };

  /** Réglage du contraste de survol : applique à chaud + mémorise (par user). */
  const onContrast = (pct: number) => {
    const v = Math.max(0, Math.min(HOVER_CONTRAST_MAX, Math.round(pct)));
    setContrast(v); setContrastSet(true);
    applyHoverContrast(v);
    writeSetting(hoverContrastKey(userKey), String(v));
  };

  const effectiveAnim =
    animations === "off" ? "figées"
    : animations === "on" ? "animées"
    : systemReduce ? "réduites (système)" : "animées (système)";

  const sections = SECTIONS.filter((s) => admin || !s.adminOnly);

  return (
    <div className="flex gap-8 items-start">
      <SectionNav sections={sections} />

      <div className="min-w-0 flex-1 max-w-3xl space-y-8">
        {/* 1 ── APPARENCE ─────────────────────────────────────── */}
        <section id="apparence" className="scroll-mt-6">
          <SurfaceCard accent="brand" title="Apparence" icon={<Palette className="h-3.5 w-3.5" />}>
            <div className="divide-y divide-border/50">
              <SettingRow
                title="Thème"
                desc="Sombre recommandé pour l'usage deux écrans en télévente."
              >
                <SegmentToggle
                  ariaLabel="Thème clair ou sombre"
                  value={theme}
                  onChange={(v) => { if (v !== theme) toggleTheme(); }}
                  options={[
                    { id: "light", label: "Jour", icon: <Sun className="h-3.5 w-3.5" /> },
                    { id: "dark",  label: "Nuit", icon: <Moon className="h-3.5 w-3.5" /> },
                  ]}
                />
              </SettingRow>
              <SettingRow
                title="Animations d'ambiance"
                desc={`Fond animé (aurora, anneaux radar) et transitions — actuellement : ${effectiveAnim}.`}
              >
                <SegmentToggle
                  ariaLabel="Niveau d'animation"
                  value={animations}
                  onChange={(v) => { setAnimations(v); writeSetting(SETTING_KEYS.animations, v); }}
                  options={ANIMATIONS}
                />
              </SettingRow>
              <SettingRow
                title="Effet au clic"
                desc="Animation au clic sur une zone vide (jamais sur les boutons ou champs), sur PC uniquement. Coupé d'office quand les animations sont désactivées."
              >
                <SegmentToggle
                  ariaLabel="Effet au clic"
                  value={clickFx}
                  onChange={(v) => { setClickFx(v); writeSetting(SETTING_KEYS.clickSparks, v); }}
                  options={CLICK_FX}
                />
              </SettingRow>
            </div>
          </SurfaceCard>
        </section>

        {/* 2 ── CONFORT DE LECTURE ────────────────────────────── */}
        <section id="lecture" className="scroll-mt-6">
          <SurfaceCard accent="amber" title="Confort de lecture" icon={<Glasses className="h-3.5 w-3.5" />}>
            <div className="divide-y divide-border/50">
              <SettingRow
                title="Taille de l'interface"
                desc="Agrandit tout l'affichage, comme un zoom navigateur."
              >
                <SegmentToggle
                  ariaLabel="Taille (zoom) de l'interface"
                  value={zoom}
                  onChange={onZoom}
                  options={ZOOMS}
                />
              </SettingRow>
              <SettingRow
                title="Densité"
                desc="Air autour des listes et tableaux, indépendamment du zoom."
              >
                <SegmentToggle
                  ariaLabel="Densité d'affichage de l'application"
                  value={densite}
                  onChange={(v) => { setDensite(v); applyDensity(v); writeSetting(SETTING_KEYS.density, v); }}
                  options={DENSITES}
                />
              </SettingRow>
              <SettingRow
                title="Contraste de survol"
                desc="Intensité de la surbrillance quand le curseur passe sur une ligne. Réglage personnel — il vous suit même sur un poste partagé."
              >
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={HOVER_CONTRAST_MAX}
                    step={5}
                    value={contrast}
                    onChange={(e) => onContrast(Number(e.target.value))}
                    aria-label="Contraste de la surbrillance au survol"
                    className="w-40 h-1.5 rounded-full appearance-none cursor-pointer bg-secondary accent-brand-500"
                  />
                  <span className="tnum text-[13px] font-semibold text-foreground w-12 text-right">
                    {contrast}%
                  </span>
                  {contrastSet && (
                    <button
                      type="button"
                      onClick={() => {
                        setContrastSet(false);
                        setContrast(HOVER_CONTRAST_DEFAULT);
                        applyHoverContrast(null);
                        writeSetting(hoverContrastKey(userKey), "");
                      }}
                      title="Revenir au rendu par défaut"
                      className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Réinit.
                    </button>
                  )}
                </div>
              </SettingRow>
              {/* Aperçu : 2 lignes qui réagissent au survol comme le reste de l'app. */}
              <div className="pt-3">
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  {["Survolez-moi pour tester le réglage", "Ligne d'exemple"].map((t, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 text-[12.5px] text-foreground/80 hover:bg-secondary transition-colors cursor-default border-b border-border/40 last:border-0"
                    >
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SurfaceCard>
        </section>

        {/* 3 ── CONSOLE & CATALOGUE ───────────────────────────── */}
        <section id="console" className="scroll-mt-6">
          <SurfaceCard accent="violet" title="Console & catalogue" icon={<MonitorCog className="h-3.5 w-3.5" />}>
            <div className="divide-y divide-border/50">
              <SettingRow
                title="Logos de marque"
                desc="Affiche les logos à côté des produits, zone par zone."
              >
                <div className="flex flex-wrap gap-1.5 items-center">
                  <ZoneChip
                    label="Console"
                    on={logoConsole === "on"}
                    onToggle={() => {
                      const v = logoConsole === "on" ? "off" : "on";
                      setLogoConsole(v); writeSetting(SETTING_KEYS.brandLogosConsole, v);
                    }}
                  />
                  <ZoneChip
                    label="Livraisons"
                    on={logoLivraison === "on"}
                    onToggle={() => {
                      const v = logoLivraison === "on" ? "off" : "on";
                      setLogoLivraison(v); writeSetting(SETTING_KEYS.brandLogosLivraison, v);
                    }}
                  />
                  <ZoneChip
                    label="Inventaire"
                    on={logoInventaire === "on"}
                    onToggle={() => {
                      const v = logoInventaire === "on" ? "off" : "on";
                      setLogoInventaire(v); writeSetting(SETTING_KEYS.brandLogosInventaire, v);
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                title="Bandeau promotions — rotation"
                desc="Fait défiler les promotions toutes les ~6 s. Désactivé : navigation manuelle."
              >
                <SegmentToggle
                  ariaLabel="Animation du bandeau promotions"
                  value={promoAnim}
                  onChange={(v) => { setPromoAnim(v); writeSetting(SETTING_KEYS.promoBannerAnim, v); }}
                  options={ONOFF}
                />
              </SettingRow>
              <SettingRow
                title="Modale « Nouvelles promotions »"
                desc="À l'ouverture, présente les promotions lancées depuis votre dernière visite."
              >
                <SegmentToggle
                  ariaLabel="Notifications des nouvelles promotions"
                  value={promoNotifs}
                  onChange={(v) => { setPromoNotifs(v); writeSetting(SETTING_KEYS.promoNotifs, v); }}
                  options={ONOFF}
                />
              </SettingRow>
              <div className="pt-3">
                <Link
                  href="/parametres/marques"
                  className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 -mx-2 hover:bg-secondary/40 transition-colors group"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <Tags className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-[13.5px] font-semibold text-foreground">Gérer les logos de marque</p>
                      <p className="text-[12px] text-muted-foreground">Associer ou remplacer un logo par marque.</p>
                    </div>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600 dark:text-brand-400">
                    Ouvrir <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </Link>
              </div>
            </div>
          </SurfaceCard>
        </section>

        {/* 4 ── ADMINISTRATION (admin) ────────────────────────── */}
        {admin && (
          <section id="admin" className="scroll-mt-6 space-y-5">
            <SurfaceCard accent="sky" title="Administration · Données SAP" icon={<Database className="h-3.5 w-3.5" />}>
              <p className="text-[12px] text-muted-foreground -mt-1 mb-1 max-w-xl">
                Centre de synchronisation — à lancer ponctuellement, pas en continu.
              </p>
              <div className="flex flex-col divide-y divide-border/50">
                <div className="flex flex-col gap-2 py-3 first:pt-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-foreground">Clients SAP</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">
                      Base clients + localisation. « Actualiser » n&apos;efface rien ;
                      « Réimport complet » repart de zéro.
                    </p>
                  </div>
                  <div className="shrink-0"><ClientImportButton /></div>
                </div>

                <div className="flex flex-col gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-foreground">Données stats (miroir comptable)</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5 max-w-xl">
                      Factures, avoirs, commandes, fournisseurs — alimente pilotage et marges.
                    </p>
                  </div>
                  <MirrorBackfillPanel />
                </div>

                <div className="flex flex-col gap-2 py-3 last:pb-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-foreground">Stock &amp; catalogue produits</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5 max-w-md">
                      Resynchronise le catalogue complet (le stock console se rafraîchit déjà seul).
                    </p>
                  </div>
                  <div className="shrink-0"><ProductsSyncButton /></div>
                </div>
              </div>
            </SurfaceCard>

            {/* Garde-fous de vente — règles métier GLOBALES (serveur), admin/direction.
                Prix < prix d'achat, volume > N × la moyenne du client, plafonds de
                commande… chaque règle est réglable Off / Avertir / Bloquer + seuils. */}
            <SurfaceCard accent="rose" title="Garde-fous de vente" icon={<ShieldAlert className="h-3.5 w-3.5" />}>
              <SafeguardsPanel />
            </SurfaceCard>

            <SurfaceCard accent="amber" title="Fraîcheur · DLC par défaut" icon={<CalendarClock className="h-3.5 w-3.5" />}>
              <ShelfLifePanel />
            </SurfaceCard>
          </section>
        )}
      </div>
    </div>
  );
}
