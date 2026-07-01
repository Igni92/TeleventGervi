"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Users, ArrowRight, Eye, EyeOff, Target, X, BadgeEuro } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { displayNameFromSlp } from "@/lib/salespeople";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { isLogisticsPreviewRole, PREVIEW_ROLE_LABELS } from "@/lib/rolePreview";

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

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((c) => (
          <CommercialCard key={c.slpName} c={c} isAdmin={isAdmin} onObjectifs={() => setObjOpen(c)} />
        ))}
      </div>
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

/* ── Carte commercial ──────────────────────────────────────── */
function CommercialCard({ c, isAdmin, onObjectifs }: { c: CommercialSap; isAdmin: boolean; onObjectifs: () => void }) {
  const pctCa = c.objectifCa > 0 ? Math.round((c.caNetYtd / c.objectifCa) * 100) : null;
  const primePct = Math.round(c.primeRate * 1000) / 10; // 0.05 → 5
  const primeSince = fmtDateShort(c.primeSince);
  return (
    <div className="relative bg-card border border-border border-l-4 border-l-brand-500 rounded-xl p-4">
      <Link
        href={`/commerciaux/${encodeURIComponent(c.slpName)}`}
        className="group block hover:opacity-95"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[12px] font-bold shrink-0">
              {avatarOf(c.email)}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-foreground leading-tight truncate" title={c.email}>
                {displayNameFromSlp(c.email) ?? localPart(c.email)}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">{c.email}</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
        </div>

        {/* Ventes SAISIES par lui (vendeur = slpName) */}
        <div className="mt-3">
          <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground inline-flex items-center gap-1">
            Ses ventes <span className="font-normal normal-case tracking-normal text-muted-foreground/70">· il a saisi le BL</span>
          </p>
          <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            <div>
              <p className="text-[15px] font-bold tnum text-foreground leading-tight">{fmtEur(c.caNetYtd)}</p>
              <p className="text-[9.5px] text-muted-foreground">CA net YTD</p>
            </div>
            <div>
              <p className="text-[15px] font-bold tnum text-foreground leading-tight">{fmtEur(c.margeBruteYtd)}</p>
              <p className="text-[9.5px] text-muted-foreground">Marge brute</p>
            </div>
            <div>
              <p className="text-[15px] font-bold tnum text-foreground leading-tight">{fmtKg(c.volumeKgYtd)}</p>
              <p className="text-[9.5px] text-muted-foreground">Volume BL</p>
            </div>
          </div>
        </div>

        {/* Ventes de SES CLIENTS (portefeuille : Client.commercial = lui) */}
        <div className="mt-2.5 flex items-center justify-between rounded-lg bg-secondary/40 px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> Ventes de ses clients
            <span className="text-muted-foreground/60">· {c.clientsActifs} actifs</span>
          </span>
          <span className="text-[13px] font-bold tnum text-foreground">{fmtEur(c.caPortefeuilleYtd)}</span>
        </div>

        {/* PRIME : taux × marge brute du portefeuille (commandes depuis primeSince) */}
        <div
          className="mt-2 flex items-center justify-between rounded-lg bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-inset ring-emerald-300/50 dark:ring-emerald-500/30 px-2.5 py-1.5"
          title={`${primePct} % de la marge brute du portefeuille · commandes depuis le ${primeSince} (marge nette transport à venir)`}
        >
          <span className="text-[10px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 min-w-0">
            <BadgeEuro className="h-3 w-3 shrink-0" /> Prime ({primePct} %)
            <span className="text-emerald-600/70 dark:text-emerald-400/70 truncate">· marge {fmtEur(c.primeMargeBrute)}</span>
          </span>
          <span className="text-[14px] font-bold tnum text-emerald-700 dark:text-emerald-300 shrink-0">{fmtEur2(c.prime)}</span>
        </div>

        <div className="mt-2.5">
          <Sparkline data={c.spark} responsive height={28} tone="brand" aria-label={`CA hebdo de ${localPart(c.email)} sur 12 semaines`} />
          <p className="text-[9px] text-muted-foreground mt-0.5">CA facturé · 12 dernières semaines</p>
        </div>
      </Link>

      {/* Objectifs : résumé + bouton popup (hors du <Link>) */}
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">
          <Target className="h-3 w-3" /> Objectif CA
          {pctCa !== null ? (
            <span className={`ml-1 tnum font-bold normal-case tracking-normal ${pctCa >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{pctCa}%</span>
          ) : (
            <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">non défini</span>
          )}
        </span>
        <button
          type="button"
          onClick={onObjectifs}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10.5px] font-semibold bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 hover:bg-brand-200 dark:hover:bg-brand-900/50 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
        >
          <Target className="h-3 w-3" /> {isAdmin ? "Gérer les objectifs" : "Objectifs"}
        </button>
      </div>

      {isAdmin && (
        <Link
          href={`/dashboard?as=${encodeURIComponent(c.slpName)}`}
          title={`Voir le cockpit comme ${localPart(c.email)}`}
          className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
        >
          <Eye className="h-3 w-3" /> Voir comme
        </Link>
      )}
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
