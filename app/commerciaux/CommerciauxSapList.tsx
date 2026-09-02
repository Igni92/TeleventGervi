"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { Users, Target, X, BadgeEuro, Eye, Loader2 } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayNameFromSlp } from "@/lib/salespeople";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { isLogisticsRoles } from "@/lib/rolePreview";

/**
 * Liste comparative des commerciaux (rattachés à un compte TeleVent) — activité
 * 12 mois. Source : /api/commerciaux/sap (scopé : un non-admin ne voit que sa
 * carte ; les codes SAP non nominatifs — CM, ".", "ADM" — sont masqués côté API).
 *
 * Régime SOBRE (zone de travail) : une rangée par commercial, colonnes tabulaires
 * (CA / marge / prime alignés), sparkline inline, en-tête gris marqué. La couleur
 * ne code QUE l'état (prime, atteinte d'objectif) ; l'action principale (objectifs)
 * porte l'accent or.
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
  /** Prime = primeMargeNette × primeRate (jamais négative). */
  prime: number;
  /** Marge brute facturée (nette d'avoirs) du portefeuille depuis primeSince. */
  primeMargeBrute: number;
  /** Coût transport estimé déduit (grilles par position / prix position). */
  primeTransport: number;
  /** Marge NETTE transport = brute − transport (base de la prime). */
  primeMargeNette: number;
  /** Taux de prime du commercial (fraction, 0.05 = 5 %). */
  primeRate: number;
  /** Date de début de la période de prime (ISO). */
  primeSince: string;
  /** Seuil de poids livré cumulé/client avant commission (kg, 0 = aucun). */
  primeSeuilKg: number;
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
  const { previewRoles, previewLabel } = useRolePreview();
  // Aperçu « terrain logistique » (préparateur / livreur) : les chiffres des
  // commerciaux (CA / marge / prime) ne les concernent pas → on les masque.
  const hideFigures = isLogisticsRoles(previewRoles);

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
      <Banner tone="info">
        Chiffres des commerciaux masqués{previewLabel ? ` en aperçu ${previewLabel}` : ""}.
      </Banner>
    );
  }

  if (error) {
    return <Banner tone="danger">Erreur de chargement des commerciaux.</Banner>;
  }
  if (restricted) {
    return <Banner tone="warning">{restricted}</Banner>;
  }
  if (!data) {
    return (
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border shadow-card" role="status" aria-label="Chargement des commerciaux">
        <div className="space-y-px">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="h-7 w-[110px]" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Aucun commercial actif"
        description="Aucune activité sur les 12 derniers mois."
      />
    );
  }

  return (
    <>
      {/* Repli MOBILE (< md) : une carte par commercial (le tableau 8 colonnes
          est illisible sur téléphone). */}
      <div className="md:hidden space-y-2.5">
        {data.map((c) => (
          <CommercialCard key={c.slpName} c={c} isAdmin={isAdmin} onObjectifs={() => setObjOpen(c)} />
        ))}
      </div>

      {/* Tableau comparatif DESKTOP (≥ md). */}
      <div className="hidden md:block overflow-hidden rounded-xl bg-card ring-1 ring-border shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              {/* En-tête GRIS MARQUÉ (zone de travail sobre). */}
              <tr className="bg-secondary/60 text-caption2 uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Commercial</th>
                <th className="px-3 py-2.5 text-right font-semibold">CA net</th>
                <th className="px-3 py-2.5 text-right font-semibold">Marge brute</th>
                <th className="px-3 py-2.5 text-right font-semibold">Volume</th>
                <th className="px-3 py-2.5 text-right font-semibold">Portefeuille</th>
                <th className="px-3 py-2.5 text-right font-semibold">Prime</th>
                <th className="px-3 py-2.5 font-semibold">Tendance</th>
                <th className="px-3 py-2.5 text-right font-semibold">Obj.</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((c) => (
                <CommercialRow
                  key={c.slpName}
                  c={c}
                  isAdmin={isAdmin}
                  onObjectifs={() => setObjOpen(c)}
                />
              ))}
            </tbody>
          </table>
        </div>
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

/* ── Carte MOBILE (une par commercial) ─────────────────────── */
function CommercialCard({ c, isAdmin, onObjectifs }: { c: CommercialSap; isAdmin: boolean; onObjectifs: () => void }) {
  const pctCa = c.objectifCa > 0 ? Math.round((c.caNetYtd / c.objectifCa) * 100) : null;
  const primePct = Math.round(c.primeRate * 1000) / 10;
  const name = displayNameFromSlp(c.email) ?? localPart(c.email);
  const Metric = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="min-w-0">
      <div className="text-caption2 uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-body font-semibold tnum whitespace-nowrap ${tone ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-caption2 text-muted-foreground">{sub}</div>}
    </div>
  );
  return (
    <div className="rounded-xl bg-card ring-1 ring-border shadow-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/commerciaux/${encodeURIComponent(c.slpName)}`} className="flex items-center gap-3 min-w-0">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-caption font-semibold text-foreground">{avatarOf(c.email)}</span>
          <span className="min-w-0">
            <span className="block truncate text-body font-semibold text-foreground">{name}</span>
            <span className="block truncate text-caption2 text-muted-foreground">{c.email}</span>
          </span>
        </Link>
        <Sparkline data={c.spark} width={72} height={26} tone="brand" aria-label={`CA hebdo de ${name}`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Metric label="CA net" value={fmtEur(c.caNetYtd)} />
        <Metric label="Marge brute" value={fmtEur(c.margeBruteYtd)} />
        <Metric label="Volume" value={fmtKg(c.volumeKgYtd)} tone="text-muted-foreground" />
        <Metric label="Portefeuille" value={fmtEur(c.caPortefeuilleYtd)} sub={`${c.clientsActifs} actifs`} />
        <Metric label="Prime" value={fmtEur2(c.prime)} sub={`${primePct} %`} tone="text-success" />
        <Metric label="Objectif" value={pctCa !== null ? `${pctCa} %` : "—"} tone={pctCa !== null && pctCa >= 100 ? "text-success" : "text-foreground"} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        {isAdmin && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/dashboard?as=${encodeURIComponent(c.slpName)}`}><Eye className="h-3.5 w-3.5" /> Voir comme</Link>
          </Button>
        )}
        <Button variant="tinted" size="sm" onClick={onObjectifs}>
          <Target className="h-3.5 w-3.5" /> {isAdmin ? "Objectifs" : "Voir"}
        </Button>
      </div>
    </div>
  );
}

/* ── Rangée comparative (une par commercial) ───────────────── */
function CommercialRow({ c, isAdmin, onObjectifs }: { c: CommercialSap; isAdmin: boolean; onObjectifs: () => void }) {
  const pctCa = c.objectifCa > 0 ? Math.round((c.caNetYtd / c.objectifCa) * 100) : null;
  const primePct = Math.round(c.primeRate * 1000) / 10; // 0.05 → 5
  const name = displayNameFromSlp(c.email) ?? localPart(c.email);
  return (
    <tr className="group transition-colors hover:bg-secondary/40">
      {/* Identité — avatar monogramme NEUTRE + lien fiche */}
      <td className="px-4 py-3">
        <Link
          href={`/commerciaux/${encodeURIComponent(c.slpName)}`}
          className="flex items-center gap-3 min-w-0 focus-visible:outline-none"
          title={c.email}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-caption font-semibold text-foreground">
            {avatarOf(c.email)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body font-semibold text-foreground group-hover:text-primary transition-colors">
              {name}
            </span>
            <span className="block truncate text-caption2 text-muted-foreground">{c.email}</span>
          </span>
        </Link>
      </td>
      {/* Ventes saisies (il a saisi le BL) */}
      <td className="px-3 py-3 text-right text-body font-semibold tnum text-foreground whitespace-nowrap">{fmtEur(c.caNetYtd)}</td>
      <td className="px-3 py-3 text-right text-body tnum text-foreground whitespace-nowrap">{fmtEur(c.margeBruteYtd)}</td>
      <td className="px-3 py-3 text-right text-body tnum text-muted-foreground whitespace-nowrap">{fmtKg(c.volumeKgYtd)}</td>
      {/* Portefeuille (ses clients, quel que soit qui a saisi) */}
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <span className="block text-body tnum text-foreground">{fmtEur(c.caPortefeuilleYtd)}</span>
        <span className="block text-caption2 text-muted-foreground">{c.clientsActifs} actifs</span>
      </td>
      {/* Prime — la couleur code l'état (montant acquis) */}
      <td
        className="px-3 py-3 text-right whitespace-nowrap"
        title={`${primePct} % de la marge NETTE transport du portefeuille (brute ${fmtEur(c.primeMargeBrute)} − transport ${fmtEur(c.primeTransport)}) · factures depuis le ${fmtDateShort(c.primeSince)}`}
      >
        <span className="block text-body font-semibold tnum text-success">{fmtEur2(c.prime)}</span>
        <span className="block text-caption2 text-muted-foreground">{primePct} %</span>
      </td>
      {/* Tendance CA — sparkline inline */}
      <td className="px-3 py-3">
        <Sparkline data={c.spark} width={110} height={28} tone="brand" aria-label={`CA hebdo de ${name} sur 12 semaines`} />
      </td>
      {/* Atteinte d'objectif CA */}
      <td className="px-3 py-3 text-right whitespace-nowrap">
        {pctCa !== null ? (
          <span className={`text-body font-semibold tnum ${pctCa >= 100 ? "text-success" : "text-foreground"}`}>{pctCa}%</span>
        ) : (
          <span className="text-caption text-muted-foreground">—</span>
        )}
      </td>
      {/* Actions — objectifs (action principale, accent or) + « voir comme » (admin) */}
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
          {isAdmin && (
            <Button asChild variant="ghost" size="sm" title={`Voir le cockpit comme ${localPart(c.email)}`}>
              <Link href={`/dashboard?as=${encodeURIComponent(c.slpName)}`}>
                <Eye className="h-3.5 w-3.5" /> Voir comme
              </Link>
            </Button>
          )}
          <Button variant="tinted" size="sm" onClick={onObjectifs}>
            <Target className="h-3.5 w-3.5" /> {isAdmin ? "Objectifs" : "Voir"}
          </Button>
        </div>
      </td>
    </tr>
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
  // Prime : taux saisi en % (5 = 5 %) + date de début (yyyy-mm-dd) + seuil kg.
  const [primeRatePct, setPrimeRatePct] = useState(Math.round(c.primeRate * 1000) / 10);
  const [primeSince, setPrimeSince] = useState(c.primeSince.slice(0, 10));
  const [primeSeuilKg, setPrimeSeuilKg] = useState(c.primeSeuilKg);
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
          seuilKg: Math.max(0, Math.round(primeSeuilKg) || 0),
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
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-caption2 uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1">
              <Target className="h-3 w-3" /> Objectifs annuels
            </p>
            <p className="text-callout font-semibold text-foreground truncate">{localPart(c.email)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <MetricRow label="CA HT" unit="€" realised={c.caNetYtd} target={ca} setTarget={setCa} fmt={fmtEur} editable={isAdmin} />
          <MetricRow label="Marge brute" unit="€" realised={c.margeBruteYtd} target={marge} setTarget={setMarge} fmt={fmtEur} editable={isAdmin} />
          <MetricRow label="Volume" unit="kg" realised={c.volumeKgYtd} target={volume} setTarget={setVolume} fmt={fmtKg} editable={isAdmin} step={100} />
          <p className="text-caption text-muted-foreground">
            Réalisé = ventes <b>saisies</b> par le commercial, depuis le 1ᵉʳ janvier.
          </p>

          {/* ── Prime ────────────────────────────────────────── */}
          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1">
                <BadgeEuro className="h-3 w-3" /> Prime
              </p>
              <span className="text-callout font-bold tnum text-success">{fmtEur2(c.prime)}</span>
            </div>
            <p className="text-caption text-muted-foreground mt-1">
              {primeRatePct}% × marge <span className="font-semibold text-foreground">nette transport</span> {fmtEur(c.primeMargeNette)} — factures du
              portefeuille (nettes d&apos;avoirs) depuis le {fmtDateShort(c.primeSince)}.
              <br />Marge brute {fmtEur(c.primeMargeBrute)} − coût transport estimé {fmtEur(c.primeTransport)}
              {" "}(grille par position du transporteur habituel × département × poids livré).
            </p>
            {isAdmin && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <label className="block">
                  <span className="text-caption2 uppercase tracking-wider font-semibold text-muted-foreground">Taux (%)</span>
                  <input
                    type="number" min={0} max={100} step={0.5}
                    value={primeRatePct}
                    onChange={(e) => setPrimeRatePct(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full h-8 px-2 rounded-md bg-secondary/60 text-right tnum text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-caption2 uppercase tracking-wider font-semibold text-muted-foreground">Depuis le</span>
                  <input
                    type="date"
                    value={primeSince}
                    onChange={(e) => setPrimeSince(e.target.value)}
                    className="mt-1 w-full h-8 px-2 rounded-md bg-secondary/60 text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-caption2 uppercase tracking-wider font-semibold text-muted-foreground">Seuil de commission (kg / client)</span>
                  <input
                    type="number" min={0} step={50}
                    value={primeSeuilKg || 0}
                    onChange={(e) => setPrimeSeuilKg(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full h-8 px-2 rounded-md bg-secondary/60 text-right tnum text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
                  />
                  <span className="mt-1 block text-caption2 text-muted-foreground">
                    Un client n&apos;est commissionné qu&apos;au-delà de ce poids livré cumulé (depuis la date ci-dessus) ; au franchissement, toutes ses factures basculent. 0 = aucun seuil.
                  </span>
                </label>
              </div>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Enregistrer
            </Button>
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
  const tone = pct === null ? "bg-secondary" : pct >= 100 ? "bg-success" : pct >= 60 ? "bg-brand-500" : "bg-warning";
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-semibold text-foreground">{label}</span>
        {editable ? (
          <label className="inline-flex items-center gap-1 text-caption text-muted-foreground">
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
          <span className="text-caption text-muted-foreground tnum">objectif {target > 0 ? fmt(target) : "—"}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-caption">
        <span className="tnum text-muted-foreground">{fmt(realised)} réalisé</span>
        {pct !== null ? (
          <span className={`tnum font-bold ${pct >= 100 ? "text-success" : "text-foreground"}`}>{pct}%</span>
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
