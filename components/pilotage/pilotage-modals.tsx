"use client";

/**
 * Modales PLEIN ÉCRAN du pilotage unifié — le « clic » qui suit le survol.
 *
 * Chaque tuile compacte de l'écran unifié s'ouvre ici en grand :
 *   • ClientsModal      — table triable de TOUS les magasins (CA, marges, transport)
 *   • SuppliersModal    — achats nets 12 mois par fournisseur
 *   • CommerciauxModal  — équipe + PRIME, et le DÉTAIL DES FACTURES qui composent
 *                         la commission d'un commercial (marge nette × taux)
 *
 * Le shell `FullscreenModal` est commun : overlay sombre, Échap + clic-dehors,
 * panneau borné 92vh. Les données sont chargées À L'OUVERTURE (pas au montage
 * de l'écran) — l'écran unifié reste léger.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, ChevronDown, ArrowLeft, Trophy, Wallet, Loader2 } from "lucide-react";
import { formatEuro, formatNum } from "./bento";
import { SEGMENTS, type Segment, type ClientSegment } from "@/lib/segments";

/* ───────────────────────── Format ───────────────────────── */

const fmtEurC = (v: number) => formatEuro(v, true);
const fmtEur = (v: number) => formatEuro(v);
const fmtEur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtPct = (v: number) => `${v.toFixed(1)} %`;
const fmtKg = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${formatNum(v)} kg`);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
/** « 2025-11 » → « novembre 2025 ». */
const monthLabelFr = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

const SEG_TONE: Record<ClientSegment, string> = {
  GMS: "text-sky-300", CHR: "text-emerald-300", EXPORT: "text-violet-300",
  RUNGIS: "text-amber-300", MIN_RUNGIS: "text-amber-300",
};

/* ───────────────────────── Shell commun ───────────────────────── */

export function FullscreenModal({
  kicker, title, sub, onClose, children,
}: {
  kicker: string;
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-8" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-baseline gap-3 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground shrink-0">{kicker}</p>
            <h2 className="text-[18px] font-semibold tracking-tight text-foreground truncate">{title}</h2>
            {sub && <span className="text-[12px] text-muted-foreground tnum truncate hidden md:inline">{sub}</span>}
          </div>
          <button onClick={onClose} aria-label="Fermer" className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground shrink-0">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-auto min-h-0">{children}</div>
      </div>
    </div>
  );
}

function ModalLoading({ label }: { label: string }) {
  return (
    <div className="h-48 grid place-items-center text-[13px] text-muted-foreground">
      <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {label}</span>
    </div>
  );
}

/* ═════════════════════════ CLIENTS ═════════════════════════
   Table triable de tous les magasins — même source que le Palmarès
   (/api/pilotage/stores) : CA, marge brute/%, poids, transport, marge nette. */

interface StoreRow {
  cardCode: string; cardName: string | null; segment: ClientSegment | null;
  ca: number; caProductNet: number; invoices: number; weightKg: number;
  marginGross: number; marginGrossPct: number; transportCost: number;
  marginNet: number; marginNetPct: number;
}
type StoreSortKey = "ca" | "marginGross" | "marginGrossPct" | "weightKg" | "transportCost" | "marginNet" | "marginNetPct" | "invoices";

const STORE_COLS: { key: StoreSortKey; label: string; fmt: (s: StoreRow) => string }[] = [
  { key: "ca",             label: "CA",          fmt: (s) => fmtEur(s.ca) },
  { key: "invoices",       label: "Fact.",       fmt: (s) => formatNum(s.invoices) },
  { key: "marginGross",    label: "Marge brute", fmt: (s) => fmtEur(s.marginGross) },
  { key: "marginGrossPct", label: "Marge %",     fmt: (s) => fmtPct(s.marginGrossPct) },
  { key: "weightKg",       label: "Poids",       fmt: (s) => fmtKg(s.weightKg) },
  { key: "transportCost",  label: "Transport",   fmt: (s) => fmtEur(s.transportCost) },
  { key: "marginNet",      label: "Marge nette", fmt: (s) => fmtEur(s.marginNet) },
  { key: "marginNetPct",   label: "Nette %",     fmt: (s) => fmtPct(s.marginNetPct) },
];

export function ClientsModal({ onClose }: { onClose: () => void }) {
  const [segment, setSegment] = useState<Segment>("ALL");
  const [data, setData] = useState<{ stores: StoreRow[]; nbStores: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<StoreSortKey>("marginNet");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    fetch(`/api/pilotage/stores?segment=${segment}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [segment]);

  const sorted = useMemo(
    () => [...(data?.stores ?? [])].sort((a, b) => (a[sort] - b[sort]) * (asc ? 1 : -1)),
    [data, sort, asc],
  );

  return (
    <FullscreenModal
      kicker="Clients · 12 mois glissants"
      title="Détail des magasins"
      sub={data ? `${data.nbStores} magasins · marge nette = brute − transport` : undefined}
      onClose={onClose}
    >
      <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/60">
        <div className="flex flex-wrap gap-1.5">
          {SEGMENTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSegment(s.id)}
              aria-pressed={segment === s.id}
              className={`h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors ${
                segment === s.id ? "bg-brand-500 text-[#0b1018]" : "bg-secondary/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Link href="/dashboard/magasins" className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-brand-400 hover:text-brand-300">
          <Trophy className="h-3.5 w-3.5" /> Ouvrir le palmarès complet →
        </Link>
      </div>

      {err && <p className="px-5 py-6 text-[13px] text-rose-400">Erreur : {err}</p>}
      {!err && !data && <ModalLoading label="Agrégation des magasins…" />}
      {data && (
        <table className="w-full text-[12px] tnum tabular-nums">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80 border-b border-border">
              <th className="text-left font-semibold px-4 py-2 w-8">#</th>
              <th className="text-left font-semibold px-2 py-2">Magasin</th>
              <th className="text-left font-semibold px-2 py-2">Seg.</th>
              {STORE_COLS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => { if (c.key === sort) setAsc((v) => !v); else { setSort(c.key); setAsc(false); } }}
                    className={`inline-flex items-center gap-1 font-semibold uppercase tracking-[0.08em] hover:text-foreground ${sort === c.key ? "text-brand-400" : ""}`}
                  >
                    {c.label}
                    {sort === c.key && <ChevronDown className={`h-3 w-3 transition-transform ${asc ? "rotate-180" : ""}`} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.cardCode} className="border-b border-border/40 hover:bg-secondary/30">
                <td className="px-4 py-1.5 text-muted-foreground/60 text-right text-[11px]">{i + 1}</td>
                <td className="px-2 py-1.5 max-w-[220px]">
                  <span className="font-medium text-foreground truncate block" title={s.cardName ?? s.cardCode}>
                    {s.cardName ?? s.cardCode}
                  </span>
                </td>
                <td className={`px-2 py-1.5 text-[10px] font-semibold ${s.segment ? SEG_TONE[s.segment] : "text-muted-foreground/50"}`}>
                  {s.segment ? (SEGMENTS.find((x) => x.id === s.segment)?.label ?? s.segment) : "—"}
                </td>
                {STORE_COLS.map((c) => {
                  const neg = (c.key === "marginNet" || c.key === "marginNetPct") && s[c.key] < 0;
                  return (
                    <td key={c.key} className={`px-3 py-1.5 text-right whitespace-nowrap ${
                      c.key === "marginNet" ? "font-semibold" : ""
                    } ${neg ? "text-rose-300" : c.key === "marginNet" ? "text-foreground" : "text-foreground/80"}`}>
                      {c.fmt(s)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={11} className="px-5 py-6 text-center text-muted-foreground">Aucun magasin sur la période.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </FullscreenModal>
  );
}

/* ═════════════════════════ FOURNISSEURS ═════════════════════════ */

interface SupplierRow { cardCode: string; cardName: string | null; totalIn: number; pdnCount: number; weightKg: number }

export function SuppliersModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ suppliers: SupplierRow[]; restricted?: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pilotage/suppliers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const max = Math.max(...(data?.suppliers ?? []).map((s) => s.totalIn), 1);
  const total = (data?.suppliers ?? []).reduce((s, x) => s + x.totalIn, 0);

  return (
    <FullscreenModal
      kicker="Achats · 12 mois glissants"
      title="Détail des fournisseurs"
      sub={data && !data.restricted ? `${data.suppliers.length} fournisseurs · ${fmtEurC(total)} d'achats nets` : undefined}
      onClose={onClose}
    >
      {err && <p className="px-5 py-6 text-[13px] text-rose-400">Erreur : {err}</p>}
      {!err && !data && <ModalLoading label="Chargement des achats…" />}
      {data?.restricted && (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Détail des achats réservé à la direction.</p>
      )}
      {data && !data.restricted && (
        <table className="w-full text-[12px] tnum tabular-nums">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80 border-b border-border">
              <th className="text-left font-semibold px-4 py-2 w-8">#</th>
              <th className="text-left font-semibold px-2 py-2">Fournisseur</th>
              <th className="text-right font-semibold px-3 py-2">Achats nets HT</th>
              <th className="text-right font-semibold px-3 py-2">Part</th>
              <th className="text-right font-semibold px-3 py-2">EM</th>
              <th className="text-right font-semibold px-3 py-2">Poids</th>
            </tr>
          </thead>
          <tbody>
            {data.suppliers.map((s, i) => (
              <tr key={s.cardCode} className="border-b border-border/40 hover:bg-secondary/30">
                <td className="px-4 py-1.5 text-muted-foreground/60 text-right text-[11px]">{i + 1}</td>
                <td className="px-2 py-1.5 max-w-[280px] relative">
                  <div className="absolute inset-y-1 left-0 bg-amber-500/12 rounded-sm" style={{ width: `${(s.totalIn / max) * 100}%` }} />
                  <span className="relative font-medium text-foreground truncate block px-1" title={s.cardName ?? s.cardCode}>
                    {s.cardName ?? s.cardCode}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right font-semibold text-foreground whitespace-nowrap">{fmtEur(s.totalIn)}</td>
                <td className="px-3 py-1.5 text-right text-foreground/70">{total > 0 ? `${((s.totalIn / total) * 100).toFixed(1)} %` : "—"}</td>
                <td className="px-3 py-1.5 text-right text-foreground/70">{formatNum(s.pdnCount)}</td>
                <td className="px-3 py-1.5 text-right text-foreground/70 whitespace-nowrap">{fmtKg(s.weightKg)}</td>
              </tr>
            ))}
            {data.suppliers.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">Aucun achat sur la période.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </FullscreenModal>
  );
}

/* ═════════════════════════ COMMERCIAUX & COMMISSIONS ═════════════════════════
   Vue 1 : l'équipe (CA net YTD, marge nette base de prime, prime €).
   Vue 2 (clic sur un commercial) : le DÉTAIL DES FACTURES qui composent sa
   commission — chaque facture avec marge brute, transport estimé, marge nette
   et la prime qu'elle génère (taux × marge nette). */

interface CommercialRow {
  slpName: string;
  clientsActifs: number;
  caNetYtd: number;
  margeBruteYtd: number;
  nbFacturesYtd: number;
  primeMargeBrute: number;
  primeTransport: number;
  primeMargeNette: number;
  prime: number;
  primeRate: number;
  primeSince: string;
}

interface CommissionDetail {
  slpName: string;
  rate: number;
  since: string;
  totals: {
    invoices: number; creditNotes: number; caHt: number; margeBrute: number;
    transport: number; cadeauxExclus: number; planchers: number; avoirs: number;
    margeNette: number; prime: number;
  };
  /** Échéancier : la prime de chaque mois (versée sur le bulletin du mois). */
  byMonth: {
    month: string; invoices: number; creditNotes: number;
    basePositive: number; avoirs: number; base: number; prime: number;
  }[];
  truncated: boolean;
  invoices: {
    docEntry: number; docNum: number | null; docDate: string; cardName: string | null; cardCode: string;
    caHt: number; margeBrute: number; cadeaux: number; kg: number; transport: number;
    carrier: string | null; mode: "direct" | "grille" | "perkg" | "aucun"; fromDoc: boolean;
    margeNette: number; plancher: boolean; prime: number;
  }[];
  creditNotes: { docEntry: number; docNum: number | null; docDate: string; cardName: string | null; cardCode: string; caHt: number; margeBrute: number; prime: number }[];
}

/** Libellé court du transporteur d'une facture — « comment ça a été livré ». */
function carrierLabel(f: { carrier: string | null; mode: CommissionDetail["invoices"][number]["mode"]; fromDoc: boolean }): React.ReactNode {
  if (!f.carrier) return <span className="text-muted-foreground/50">—</span>;
  const tone = f.mode === "direct" ? "text-emerald-300" : f.mode === "aucun" ? "text-amber-300" : "text-foreground/70";
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`} title={
      (f.fromDoc ? "Transporteur du document (réel)" : "Tournée habituelle du client")
      + (f.mode === "aucun" ? " — aucun tarif paramétré pour ce transporteur" : "")
    }>
      {f.carrier}
      {!f.fromDoc && <span className="text-[8.5px] text-muted-foreground/70">(hab.)</span>}
      {f.mode === "aucun" && <span className="text-[8.5px]">⚠ sans tarif</span>}
    </span>
  );
}

export function CommerciauxModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<CommercialRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommissionDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/commerciaux/sap", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j) => { if (!cancelled) setList(j.commerciaux ?? []); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null); setDetailErr(null);
    fetch(`/api/pilotage/commissions?slp=${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j) => { if (!cancelled) setDetail(j); })
      .catch((e) => { if (!cancelled) setDetailErr(String(e)); });
    return () => { cancelled = true; };
  }, [selected]);

  return (
    <FullscreenModal
      kicker="Équipe commerciale"
      title={selected ? `Commissions · ${selected}` : "Commerciaux & commissions"}
      sub={selected
        ? (detail ? `prime ${(detail.rate * 100).toFixed(0)} % × marge nette transport depuis le ${fmtDate(detail.since)}` : undefined)
        : "clic sur un commercial = le détail des factures derrière sa prime"}
      onClose={onClose}
    >
      {err && <p className="px-5 py-6 text-[13px] text-rose-400">Erreur : {err}</p>}
      {!err && !list && <ModalLoading label="Chargement de l'équipe…" />}

      {/* ── Vue 1 : l'équipe ── */}
      {list && !selected && (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((c) => (
            <button
              key={c.slpName}
              type="button"
              onClick={() => setSelected(c.slpName)}
              className="text-left rounded-xl border border-border bg-secondary/20 hover:bg-secondary/40 hover:border-brand-500/50 transition-colors p-4 group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[15px] font-bold text-foreground">{c.slpName}</span>
                <span className="text-[10.5px] text-muted-foreground">{c.clientsActifs} clients · {formatNum(c.nbFacturesYtd)} fact. YTD</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                <div>
                  <p className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">CA net YTD</p>
                  <p className="font-semibold text-foreground tnum">{fmtEurC(c.caNetYtd)}</p>
                </div>
                <div>
                  <p className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">Marge brute YTD</p>
                  <p className="font-semibold text-foreground tnum">{fmtEurC(c.margeBruteYtd)}</p>
                </div>
                <div>
                  <p className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">Marge nette (base prime)</p>
                  <p className="font-semibold text-foreground tnum">{fmtEurC(c.primeMargeNette)}</p>
                </div>
                <div>
                  <p className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">Prime ({(c.primeRate * 100).toFixed(0)} %)</p>
                  <p className="font-bold text-brand-400 tnum inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5" />{fmtEur2(c.prime)}</p>
                </div>
              </div>
              <p className="mt-2.5 text-[10.5px] text-muted-foreground group-hover:text-brand-400 transition-colors">
                Voir le détail des factures →
              </p>
            </button>
          ))}
          {list.length === 0 && (
            <p className="col-span-full py-8 text-center text-[13px] text-muted-foreground">Aucun commercial actif sur 12 mois.</p>
          )}
        </div>
      )}

      {/* ── Vue 2 : détail des factures d'UN commercial ── */}
      {selected && (
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-5 py-2.5 border-b border-border/60 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Équipe
            </button>
            {detail && (
              <>
                <Stat label="Marge brute" v={fmtEurC(detail.totals.margeBrute)} />
                {detail.totals.cadeauxExclus > 0 && (
                  <Stat label="Cadeaux neutralisés" v={fmtEurC(detail.totals.cadeauxExclus)} />
                )}
                <Stat label="Transport" v={`− ${fmtEurC(detail.totals.transport)}`} />
                {detail.totals.avoirs > 0 && <Stat label="Avoirs repris" v={`− ${fmtEurC(detail.totals.avoirs)}`} />}
                <Stat label="Base retenue" v={fmtEurC(detail.totals.margeNette)} />
                <Stat label={`Prime (${(detail.rate * 100).toFixed(0)} %)`} v={fmtEur2(detail.totals.prime)} brand />
                <span className="text-[10.5px] text-muted-foreground">
                  {formatNum(detail.totals.invoices)} factures · {formatNum(detail.totals.creditNotes)} avoirs
                  {detail.totals.planchers > 0 && ` · ${detail.totals.planchers} au plancher`}
                </span>
              </>
            )}
          </div>

          {detailErr && <p className="px-5 py-6 text-[13px] text-rose-400">Erreur : {detailErr}</p>}
          {!detailErr && !detail && <ModalLoading label="Calcul facture par facture…" />}
          {detail && (
            <div className="overflow-auto">
              {/* ── Échéancier MENSUEL — la prime est payée chaque mois sur le
                   bulletin (ligne automatique des éléments de salaires). ── */}
              {detail.byMonth.length > 0 && (
                <div className="px-5 pt-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-muted-foreground mb-1.5">
                    Prime par mois — versée sur le bulletin (Éléments de salaires)
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {detail.byMonth.map((m) => (
                      <div key={m.month} className="shrink-0 rounded-lg border border-border bg-secondary/25 px-3 py-2 min-w-[128px]">
                        <p className="text-[10.5px] font-semibold text-muted-foreground capitalize">{monthLabelFr(m.month)}</p>
                        <p className="text-[15px] font-bold text-brand-400 tnum tabular-nums leading-tight">{fmtEur2(m.prime)}</p>
                        <p className="text-[9.5px] text-muted-foreground tnum">
                          base {fmtEurC(m.base)} · {formatNum(m.invoices)} fact.{m.avoirs > 0 ? ` · avoirs −${fmtEurC(m.avoirs)}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <table className="w-full text-[11.5px] tnum tabular-nums">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80 border-b border-border">
                    <th className="text-left font-semibold px-4 py-2">Date</th>
                    <th className="text-left font-semibold px-2 py-2">N°</th>
                    <th className="text-left font-semibold px-2 py-2">Client</th>
                    <th className="text-right font-semibold px-3 py-2">CA HT</th>
                    <th className="text-right font-semibold px-3 py-2">Marge brute</th>
                    <th className="text-right font-semibold px-3 py-2">Poids</th>
                    <th className="text-left font-semibold px-2 py-2">Livré par</th>
                    <th className="text-right font-semibold px-3 py-2">Transport</th>
                    <th className="text-right font-semibold px-3 py-2">Marge nette</th>
                    <th className="text-right font-semibold px-3 py-2">Prime</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.invoices.map((f) => (
                    <tr key={f.docEntry} className="border-b border-border/40 hover:bg-secondary/30">
                      <td className="px-4 py-1 whitespace-nowrap text-foreground/70">{fmtDate(f.docDate)}</td>
                      <td className="px-2 py-1 text-foreground/70">{f.docNum ?? f.docEntry}</td>
                      <td className="px-2 py-1 max-w-[200px]">
                        <span className="truncate block font-medium text-foreground" title={f.cardName ?? f.cardCode}>{f.cardName ?? f.cardCode}</span>
                        {f.cadeaux > 0 && (
                          <span className="text-[9px] text-emerald-300/90 block">🎁 cadeau neutralisé {fmtEur(f.cadeaux)}</span>
                        )}
                      </td>
                      <td className="px-3 py-1 text-right whitespace-nowrap text-foreground/80">{fmtEur(f.caHt)}</td>
                      <td className="px-3 py-1 text-right whitespace-nowrap text-foreground/80">{fmtEur(f.margeBrute)}</td>
                      <td className="px-3 py-1 text-right whitespace-nowrap text-foreground/60">{fmtKg(f.kg)}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-[10.5px]">{carrierLabel(f)}</td>
                      <td className="px-3 py-1 text-right whitespace-nowrap text-foreground/60">{f.transport > 0 ? `− ${fmtEur(f.transport)}` : "—"}</td>
                      <td className={`px-3 py-1 text-right whitespace-nowrap font-semibold ${f.margeNette < 0 ? "text-rose-300" : "text-foreground"}`}>
                        {fmtEur(f.margeNette)}
                        {f.plancher && <span className="text-[8.5px] text-muted-foreground block leading-none">plancher → 0</span>}
                      </td>
                      <td className={`px-3 py-1 text-right whitespace-nowrap font-semibold ${f.prime < 0 ? "text-rose-300" : "text-brand-400"}`}>{fmtEur2(f.prime)}</td>
                    </tr>
                  ))}
                  {detail.creditNotes.length > 0 && (
                    <tr><td colSpan={10} className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.12em] font-bold text-rose-300/80">Avoirs (marge reprise — la base totale ne descend jamais sous 0)</td></tr>
                  )}
                  {detail.creditNotes.map((f) => (
                    <tr key={`cn-${f.docEntry}`} className="border-b border-border/40 hover:bg-secondary/30">
                      <td className="px-4 py-1 whitespace-nowrap text-foreground/70">{fmtDate(f.docDate)}</td>
                      <td className="px-2 py-1 text-foreground/70">{f.docNum ?? f.docEntry}</td>
                      <td className="px-2 py-1 max-w-[200px]"><span className="truncate block font-medium text-foreground" title={f.cardName ?? f.cardCode}>{f.cardName ?? f.cardCode}</span></td>
                      <td className="px-3 py-1 text-right whitespace-nowrap text-rose-300/90">− {fmtEur(f.caHt)}</td>
                      <td className="px-3 py-1 text-right whitespace-nowrap text-rose-300/90">− {fmtEur(f.margeBrute)}</td>
                      <td className="px-3 py-1 text-right text-foreground/40">—</td>
                      <td className="px-2 py-1 text-foreground/40">—</td>
                      <td className="px-3 py-1 text-right text-foreground/40">—</td>
                      <td className="px-3 py-1 text-right whitespace-nowrap text-rose-300/90">− {fmtEur(f.margeBrute)}</td>
                      <td className="px-3 py-1 text-right whitespace-nowrap font-semibold text-rose-300">{fmtEur2(f.prime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.truncated && (
                <p className="px-5 py-2.5 text-[11px] text-muted-foreground">
                  Liste plafonnée aux 400 documents les plus récents — les totaux du bandeau couvrent bien TOUTE la période.
                </p>
              )}
              <p className="px-5 pb-4 pt-1 text-[10.5px] text-muted-foreground/80 max-w-[110ch]">
                Règles : <b className="text-foreground/80">cadeaux neutralisés</b> (lignes offertes 0 € / remise 100 %),{" "}
                <b className="text-foreground/80">plancher 0 par facture</b> (une marge nette négative ne ronge pas la prime),{" "}
                <b className="text-foreground/80">avoirs repris</b> sans jamais passer la base sous 0. Transport <b className="text-foreground/80">par
                position</b> : transporteur réel du document (repli tournée habituelle) — direct = coût/position de la flotte,
                externe = grille département × tranche ; « ⚠ sans tarif » = transporteur connu mais aucune grille/€-kg paramétré
                (à compléter dans Coût de transport). Identique au calcul de la page Effectif.
              </p>
            </div>
          )}
        </div>
      )}
    </FullscreenModal>
  );
}

function Stat({ label, v, brand }: { label: string; v: string; brand?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">{label}</span>
      <span className={`text-[13px] font-bold tnum ${brand ? "text-brand-400" : "text-foreground"}`}>{v}</span>
    </span>
  );
}
