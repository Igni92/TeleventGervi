"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, ShieldAlert, Users, ArrowRight, ChevronLeft, ChevronRight, Eye, EyeOff, Target, X, BadgeEuro } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { displayNameFromSlp } from "@/lib/salespeople";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { isLogisticsPreviewRole, PREVIEW_ROLE_LABELS } from "@/lib/rolePreview";
import { DUR, EASE } from "@/lib/motion";

/**
 * Liste des commerciaux (rattachés à un compte TeleVent) — activité 12 mois.
 * Source : /api/commerciaux/sap (scopé : un non-admin ne voit que sa carte ;
 * les codes SAP non nominatifs — CM, ".", "ADM" — sont masqués côté API).
 *
 * Pour chaque commercial on distingue :
 *   - VENTES SAISIES   (il a entré le BL/la facture : vendeur = slpName)
 *   - VENTES DE SES CLIENTS (portefeuille : Client.commercial = lui, quel que
 *     soit qui a saisi)
 * + une popup OBJECTIFS multi-métriques (CA HT / marge brute / volume kg).
 */

interface CommercialSap {
  slpName: string;
  email: string;
  clientsActifs: number;
  caNetYtd: number;
  margeBruteYtd: number;
  nbFacturesYtd: number;
  caBlYtd: number;
  nbCommandesYtd: number;
  volumeKgYtd: number;
  caPortefeuilleYtd: number;
  /** Prime = primeMargeBrute × primeRate. */
  prime: number;
  /** Marge brute facturée (nette d'avoirs) du portefeuille depuis primeSince. */
  primeMargeBrute: number;
  /** Taux de prime du commercial (fraction, 0.05 = 5 %). */
  primeRate: number;
  /** Date de début de la période de prime (ISO). */
  primeSince: string;
  objectifCa: number;
  objectifMarge: number;
  objectifVolume: number;
  spark: number[];
}

const fmtEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
// Prime : montant fin (cents significatifs) → 2 décimales.
const fmtEur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtDateShort = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
};
const fmtKg = (v: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} kg`;
const localPart = (email: string) => email.split("@")[0] || email;
const avatarOf = (email: string) => {
  const p = localPart(email).split(/[.\-_]/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? p[0]?.[1] ?? "")).toUpperCase() || "?";
};

export function CommerciauxSapList() {
  const { previewRole } = useRolePreview();
  // Aperçu « terrain logistique » (préparateur / livreur) : les chiffres des
  // commerciaux (CA / marge / prime) ne les concernent pas → on les masque.
  const hideFigures = isLogisticsPreviewRole(previewRole);

  const [data, setData] = useState<CommercialSap[] | null>(null);
  const [restricted, setRestricted] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [objOpen, setObjOpen] = useState<CommercialSap | null>(null);
  // Carousel : on affiche UN commercial à la fois (index) et on garde le sens du
  // dernier déplacement (dir) pour orienter l'animation de glissement.
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(0);
  const reduce = useReducedMotion();

  const load = useCallback(() => {
    return fetch("/api/commerciaux/sap", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.restricted && j.message) setRestricted(j.message);
        setIsAdmin(!!j.scope?.all);
        setData(j.commerciaux ?? []);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (hideFigures) return; // aperçu terrain : on ne charge même pas les chiffres
    load();
  }, [load, hideFigures]);

  // Navigation clavier ← / → entre commerciaux (inactive si une popup est ouverte
  // ou si le focus est dans un champ de saisie).
  const count = data?.length ?? 0;
  useEffect(() => {
    if (count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (objOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setDir(-1); setIndex((i) => (i - 1 + count) % count); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setDir(1); setIndex((i) => (i + 1) % count); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, objOpen]);

  const patchObjectifs = (slp: string, patch: Partial<CommercialSap>) =>
    setData((cur) => (cur ? cur.map((c) => (c.slpName === slp ? { ...c, ...patch } : c)) : cur));

  if (hideFigures) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <EyeOff className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-[13px] text-muted-foreground">
          Chiffres des commerciaux masqués{previewRole ? ` en aperçu ${PREVIEW_ROLE_LABELS[previewRole]}` : ""}.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[13px] text-rose-600 dark:text-rose-400 py-6 text-center border border-border rounded-xl bg-card">
        Erreur de chargement des commerciaux.
      </p>
    );
  }
  if (restricted) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-4 py-3">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">{restricted}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-32 flex items-center justify-center border border-border rounded-xl bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground py-8 text-center border border-border rounded-xl bg-card">
        Aucun commercial avec activité sur les 12 derniers mois.
      </p>
    );
  }

  // Index borné (si la liste rétrécit après un rechargement) + commercial courant.
  const safeIndex = Math.min(index, data.length - 1);
  const current = data[safeIndex];
  const go = (delta: number) => {
    setDir(delta);
    setIndex((safeIndex + delta + data.length) % data.length);
  };
  const jump = (i: number) => { setDir(i > safeIndex ? 1 : -1); setIndex(i); };

  const slide = {
    enter: (d: number) => ({ opacity: 0, x: reduce ? 0 : d >= 0 ? 36 : -36 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduce ? 0 : d >= 0 ? -36 : 36 }),
  };

  return (
    <>
      {data.length === 1 ? (
        <CommercialCard c={current} isAdmin={isAdmin} onObjectifs={() => setObjOpen(current)} />
      ) : (
        <div className="relative overflow-hidden" role="region" aria-roledescription="carrousel" aria-label="Commerciaux">
          {/* Flèches latérales (écrans larges) — dans les gouttières de la carte */}
          <NavArrow dir="prev" onClick={() => go(-1)} className="hidden lg:flex absolute left-2 top-1/2 -translate-y-1/2 z-10" />
          <NavArrow dir="next" onClick={() => go(1)} className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 z-10" />

          <AnimatePresence initial={false} custom={dir} mode="wait">
            <motion.div
              key={current.slpName}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: DUR.base, ease: EASE.out }}
            >
              <CommercialCard c={current} isAdmin={isAdmin} onObjectifs={() => setObjOpen(current)} />
            </motion.div>
          </AnimatePresence>

          {/* Pager : flèches (mobile) + points cliquables + compteur */}
          <div className="mt-3 flex items-center justify-center gap-3">
            <NavArrow dir="prev" onClick={() => go(-1)} small className="lg:hidden" />
            <div className="flex items-center gap-1.5">
              {data.map((c, i) => (
                <button
                  key={c.slpName}
                  type="button"
                  onClick={() => jump(i)}
                  aria-label={`Voir ${displayNameFromSlp(c.email) ?? localPart(c.email)}`}
                  aria-current={i === safeIndex}
                  className={`h-1.5 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none ${
                    i === safeIndex ? "w-5 bg-brand-500" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                />
              ))}
            </div>
            <NavArrow dir="next" onClick={() => go(1)} small className="lg:hidden" />
            <span className="ml-1 text-[11px] tnum text-muted-foreground">{safeIndex + 1}/{data.length}</span>
          </div>
        </div>
      )}
      {objOpen && (
        <ObjectifModal
          c={data.find((x) => x.slpName === objOpen.slpName) ?? objOpen}
          isAdmin={isAdmin}
          onClose={() => setObjOpen(null)}
          onSaved={patchObjectifs}
          onReload={load}
        />
      )}
    </>
  );
}

/* ── Flèche de navigation du carousel ──────────────────────── */
function NavArrow({ dir, onClick, small = false, className = "" }: { dir: "prev" | "next"; onClick: () => void; small?: boolean; className?: string }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Commercial précédent" : "Commercial suivant"}
      className={`${small ? "h-8 w-8" : "h-10 w-10"} shrink-0 inline-flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground hover:border-foreground/30 hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none ${className}`}
    >
      <Icon className={small ? "h-4 w-4" : "h-5 w-5"} />
    </button>
  );
}

/* ── Carte commercial (large, une par écran dans le carousel) ─── */
function CommercialCard({ c, isAdmin, onObjectifs }: { c: CommercialSap; isAdmin: boolean; onObjectifs: () => void }) {
  const pctCa = c.objectifCa > 0 ? Math.round((c.caNetYtd / c.objectifCa) * 100) : null;
  const primePct = Math.round(c.primeRate * 1000) / 10; // 0.05 → 5
  const primeSince = fmtDateShort(c.primeSince);
  const name = displayNameFromSlp(c.email) ?? localPart(c.email);
  return (
    <div className="relative bg-card border border-border border-l-4 border-l-brand-500 rounded-2xl p-4 sm:p-5 lg:px-14 lg:py-6 overflow-hidden">
      {/* En-tête : identité (lien fiche) + « Voir comme » (admin) */}
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/commerciaux/${encodeURIComponent(c.slpName)}`}
          className="group flex items-center gap-3 min-w-0"
        >
          <span className="h-12 w-12 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[15px] font-bold shrink-0">
            {avatarOf(c.email)}
          </span>
          <div className="min-w-0">
            <p className="text-[18px] font-semibold text-foreground leading-tight truncate inline-flex items-center gap-1.5" title={c.email}>
              {name}
              <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </p>
            <p className="text-[11px] text-muted-foreground truncate">{c.email}</p>
          </div>
        </Link>
        {isAdmin && (
          <Link
            href={`/dashboard?as=${encodeURIComponent(c.slpName)}`}
            title={`Voir le cockpit comme ${localPart(c.email)}`}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" /> Voir comme
          </Link>
        )}
      </div>

      {/* Stats : ventes saisies + portefeuille + prime, sur une seule ligne (écrans larges) */}
      <p className="mt-4 text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground inline-flex items-center gap-1">
        Ses ventes <span className="font-normal normal-case tracking-normal text-muted-foreground/70">· il a saisi le BL</span>
      </p>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Tile value={fmtEur(c.caNetYtd)} label="CA net YTD" />
        <Tile value={fmtEur(c.margeBruteYtd)} label="Marge brute" />
        <Tile value={fmtKg(c.volumeKgYtd)} label="Volume BL" />
        <Tile
          value={fmtEur(c.caPortefeuilleYtd)}
          label={`Ventes clients · ${c.clientsActifs} actifs`}
          icon={Users}
        />
        <Tile
          value={fmtEur2(c.prime)}
          label={`Prime ${primePct} % · marge ${fmtEur(c.primeMargeBrute)}`}
          icon={BadgeEuro}
          tone="emerald"
          title={`${primePct} % de la marge brute du portefeuille · commandes depuis le ${primeSince} (marge nette transport à venir)`}
        />
      </div>

      {/* Tendance CA — grande sparkline pleine largeur */}
      <div className="mt-4">
        <Sparkline data={c.spark} responsive height={56} tone="brand" aria-label={`CA hebdo de ${localPart(c.email)} sur 12 semaines`} />
        <p className="text-[9.5px] text-muted-foreground mt-1">CA facturé · 12 dernières semaines</p>
      </div>

      {/* Objectifs : résumé + bouton popup */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">
          <Target className="h-3.5 w-3.5" /> Objectif CA
          {pctCa !== null ? (
            <span className={`ml-1 tnum font-bold normal-case tracking-normal ${pctCa >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{pctCa}%</span>
          ) : (
            <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">non défini</span>
          )}
        </span>
        <button
          type="button"
          onClick={onObjectifs}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 hover:bg-brand-200 dark:hover:bg-brand-900/50 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
        >
          <Target className="h-3.5 w-3.5" /> {isAdmin ? "Gérer les objectifs" : "Objectifs"}
        </button>
      </div>
    </div>
  );
}

/* ── Tuile de statistique de la carte large ────────────────── */
function Tile({
  value, label, icon: Icon, tone = "default", title,
}: {
  value: string;
  label: string;
  icon?: typeof Users;
  tone?: "default" | "emerald";
  title?: string;
}) {
  const emerald = tone === "emerald";
  return (
    <div
      title={title}
      className={`rounded-xl px-3 py-2.5 ${
        emerald
          ? "bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-inset ring-emerald-300/50 dark:ring-emerald-500/30"
          : "bg-secondary/40"
      }`}
    >
      <p className={`text-[17px] lg:text-[19px] font-bold tnum leading-tight truncate ${emerald ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"}`}>
        {value}
      </p>
      <p className={`mt-0.5 flex items-center gap-1 text-[9.5px] truncate ${emerald ? "text-emerald-600/80 dark:text-emerald-400/80" : "text-muted-foreground"}`}>
        {Icon && <Icon className="h-3 w-3 shrink-0" />} <span className="truncate">{label}</span>
      </p>
    </div>
  );
}

/* ── Popup objectifs (CA / marge / volume) ─────────────────── */
function ObjectifModal({
  c, isAdmin, onClose, onSaved, onReload,
}: {
  c: CommercialSap;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (slp: string, patch: Partial<CommercialSap>) => void;
  onReload: () => void;
}) {
  const [ca, setCa] = useState(c.objectifCa);
  const [marge, setMarge] = useState(c.objectifMarge);
  const [volume, setVolume] = useState(c.objectifVolume);
  // Prime : taux saisi en % (5 = 5 %) + date de début (yyyy-mm-dd).
  const [primeRatePct, setPrimeRatePct] = useState(Math.round(c.primeRate * 1000) / 10);
  const [primeSince, setPrimeSince] = useState(c.primeSince.slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    const payload = {
      slpName: c.slpName,
      objectifCa: Math.max(0, Math.round(ca) || 0),
      objectifMarge: Math.max(0, Math.round(marge) || 0),
      objectifVolume: Math.max(0, Math.round(volume) || 0),
    };
    try {
      const r = await fetch("/api/commerciaux/objectif", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error();
      // Prime : taux (fraction) + date de début. La marge/prime sont recalculées
      // côté serveur (dépend des factures) → on recharge la liste après coup.
      const rp = await fetch("/api/commerciaux/prime", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slpName: c.slpName,
          rate: Math.max(0, Math.min(1, primeRatePct / 100)),
          since: new Date(`${primeSince}T00:00:00Z`).toISOString(),
        }),
      });
      if (!rp.ok) throw new Error();
      onSaved(c.slpName, {
        objectifCa: payload.objectifCa,
        objectifMarge: payload.objectifMarge,
        objectifVolume: payload.objectifVolume,
      });
      onReload(); // marge brute + prime recalculées (nouvelle date/taux)
      toast.success(`Objectifs & prime de ${localPart(c.email)} enregistrés`);
      onClose();
    } catch { toast.error("Erreur enregistrement"); }
    finally { setSaving(false); }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1">
              <Target className="h-3 w-3" /> Objectifs annuels
            </p>
            <p className="text-[14px] font-semibold text-foreground truncate">{localPart(c.email)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <MetricRow label="CA HT" unit="€" realised={c.caNetYtd} target={ca} setTarget={setCa} fmt={fmtEur} editable={isAdmin} />
          <MetricRow label="Marge brute" unit="€" realised={c.margeBruteYtd} target={marge} setTarget={setMarge} fmt={fmtEur} editable={isAdmin} />
          <MetricRow label="Volume" unit="kg" realised={c.volumeKgYtd} target={volume} setTarget={setVolume} fmt={fmtKg} editable={isAdmin} step={100} />
          <p className="text-[10.5px] text-muted-foreground">
            Réalisé = ventes <b>saisies</b> par le commercial, depuis le 1ᵉʳ janvier.
          </p>

          {/* ── Prime ────────────────────────────────────────── */}
          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1">
                <BadgeEuro className="h-3 w-3" /> Prime
              </p>
              <span className="text-[14px] font-bold tnum text-emerald-700 dark:text-emerald-300">{fmtEur2(c.prime)}</span>
            </div>
            <p className="text-[10.5px] text-muted-foreground mt-1">
              {primeRatePct}% × marge brute {fmtEur(c.primeMargeBrute)} — factures du portefeuille
              (nettes d&apos;avoirs) depuis le {fmtDateShort(c.primeSince)}.
              <br />La marge « nette transport » n&apos;est pas encore déduite.
            </p>
            {isAdmin && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Taux (%)</span>
                  <input
                    type="number" min={0} max={100} step={0.5}
                    value={primeRatePct}
                    onChange={(e) => setPrimeRatePct(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full h-8 px-2 rounded-md bg-secondary/60 text-right tnum text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Depuis le</span>
                  <input
                    type="date"
                    value={primeSince}
                    onChange={(e) => setPrimeSince(e.target.value)}
                    className="mt-1 w-full h-8 px-2 rounded-md bg-secondary/60 text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-8 px-3.5 rounded-md text-[12.5px] font-semibold bg-brand-600 hover:bg-brand-700 text-white inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Enregistrer
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

function MetricRow({
  label, unit, realised, target, setTarget, fmt, editable, step = 1000,
}: {
  label: string; unit: string; realised: number; target: number;
  setTarget: (n: number) => void; fmt: (n: number) => string; editable: boolean; step?: number;
}) {
  const pct = target > 0 ? Math.round((realised / target) * 100) : null;
  const barW = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const tone = pct === null ? "bg-secondary" : pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-brand-500" : "bg-amber-500";
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-foreground">{label}</span>
        {editable ? (
          <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>Objectif</span>
            <input
              type="number" min={0} step={step}
              value={target || 0}
              onChange={(e) => setTarget(parseFloat(e.target.value) || 0)}
              className="w-28 h-7 px-1.5 rounded-md bg-secondary/60 text-right tnum text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
            />
            <span className="text-muted-foreground/70">{unit}</span>
          </label>
        ) : (
          <span className="text-[11px] text-muted-foreground tnum">objectif {target > 0 ? fmt(target) : "—"}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="tnum text-muted-foreground">{fmt(realised)} réalisé</span>
        {pct !== null ? (
          <span className={`tnum font-bold ${pct >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{pct}%</span>
        ) : (
          <span className="text-muted-foreground/70">objectif non défini</span>
        )}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-secondary/70 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${barW}%` }} />
      </div>
    </div>
  );
}
