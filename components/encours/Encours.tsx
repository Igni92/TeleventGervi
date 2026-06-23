"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, RefreshCw, Euro, AlertTriangle, Clock, Flame, Search, ExternalLink, X, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ClientLink } from "@/components/ClientLink";
import { RelanceDialog } from "@/components/encours/RelanceDialog";

interface AttributedAvoir {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  amount: number;    // montant de l'avoir imputé à cette facture (positif)
}
interface InvoiceLine {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  dueDate: string | null;
  balance: number;        // solde brut de la facture
  overdueDays: number;
  avoirs: AttributedAvoir[]; // avoirs rattachés à cette facture
  avoirsTotal: number;       // somme des avoirs attribués
  net: number;               // net facture = balance − avoirsTotal (≥ 0)
}
interface ClientEncours {
  cardCode: string;
  cardName: string;
  clientId: string | null;
  encours: number;          // NET (paiements + avoirs déduits)
  brut: number;             // somme des factures (avant déduction)
  encaisse: number;         // paiements + avoirs NON affectés (déduit en ligne)
  avoirsAttribues: number;  // avoirs rattachés à une facture (déduit par facture)
  countOpen: number;
  b3045: number; // 30-45 j (brut)
  b4590: number; // 45-90 j (brut)
  b90: number;   // > 90 j (brut)
  countLate: number;
  maxOverdueDays: number;
  invoices: InvoiceLine[];
}
interface EncoursData {
  company: string;
  totals: { encours: number; encaisse: number; avoirsAttribues: number; overdueTotal: number; b3045: number; b4590: number; b90: number; invoices: number; clients: number };
  clients: ClientEncours[];
}

type SortKey = "cardName" | "encours" | "countOpen" | "b3045" | "b4590" | "b90" | "countLate";

const eur = (n: number) =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)} k€` : `${Math.round(n)} €`;
const eurOrDash = (n: number) => (n > 0 ? eur(n) : "—");
/** Montant exact au centime — pour le DÉTAIL des encours (jamais arrondi). */
const eurExact = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const frDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Ligne mémoïsée : la recherche/tri ne re-rend QUE les lignes dont les props
 *  changent (avant : toute la liste re-rendait à chaque frappe). */
const EncoursRow = memo(function EncoursRow({ c, onSelect }: { c: ClientEncours; onSelect: (c: ClientEncours) => void }) {
  return (
    <tr className="hover:bg-secondary/30 transition-colors cursor-pointer" onClick={() => onSelect(c)}>
      <td className="px-3 py-2">
        {/* Accès fiche client (ClientLink stoppe la propagation → n'ouvre pas la modale) */}
        <ClientLink
          code={c.cardCode}
          name={c.cardName}
          preferCode
          className="font-mono font-semibold text-foreground text-left hover:underline decoration-brand-500/60 underline-offset-2 cursor-pointer"
        />
        <div className="text-[10.5px] text-muted-foreground truncate max-w-[220px]">{c.cardName}</div>
      </td>
      <td className="px-3 py-2 text-right font-bold tnum text-foreground">{eur(c.encours)}</td>
      <td className="px-3 py-2 text-right tnum text-muted-foreground">{c.countOpen}</td>
      <td className="px-3 py-2 text-right tnum">{c.b3045 > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-400">{eur(c.b3045)}</span> : <span className="text-muted-foreground/40">—</span>}</td>
      <td className="px-3 py-2 text-right tnum">{c.b4590 > 0 ? <span className="font-semibold text-rose-500 dark:text-rose-400">{eur(c.b4590)}</span> : <span className="text-muted-foreground/40">—</span>}</td>
      <td className="px-3 py-2 text-right tnum">{c.b90 > 0 ? <span className="font-bold text-rose-600 dark:text-rose-400">{eur(c.b90)}</span> : <span className="text-muted-foreground/40">—</span>}</td>
      <td className="px-3 py-2 text-right tnum">{c.countLate > 0 ? <span className="font-semibold text-rose-600 dark:text-rose-400">{c.countLate}</span> : <span className="text-muted-foreground/40">—</span>}</td>
      <td className="px-2 py-2 text-right">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground"><ExternalLink className="h-3.5 w-3.5" /></span>
      </td>
    </tr>
  );
});
EncoursRow.displayName = "EncoursRow";

export function Encours() {
  const [data, setData] = useState<EncoursData | null>(null);
  const [loading, setLoading] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<ClientEncours | null>(null);
  const [relance, setRelance] = useState<ClientEncours | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "encours", dir: "desc" });
  const onSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "cardName" ? "asc" : "desc" }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/encours", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Erreur de chargement"); return; }
      setData(j);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const debSearch = useDebounced(search, 250);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = debSearch.trim().toLowerCase();
    const filtered = data.clients
      .filter((c) => (!overdueOnly || c.countLate > 0))
      .filter((c) => !q || c.cardName.toLowerCase().includes(q) || c.cardCode.toLowerCase().includes(q));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) =>
      sort.key === "cardName"
        ? dir * a.cardName.localeCompare(b.cardName, "fr")
        : dir * ((a[sort.key] as number) - (b[sort.key] as number)),
    );
  }, [data, overdueOnly, debSearch, sort]);

  return (
    <div className="space-y-4">
      {/* KPIs — paiement à 30 j ; tranches de retard EXCLUSIVES */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi icon={Euro} tone="brand" label="Encours total" value={data ? eur(data.totals.encours) : "—"} />
        <Kpi icon={AlertTriangle} tone="amber" label="Retard 30-45 j" value={data ? eur(data.totals.b3045) : "—"} />
        <Kpi icon={Clock} tone="rose" label="Retard 45-90 j" value={data ? eur(data.totals.b4590) : "—"} />
        <Kpi icon={Flame} tone="rose" label="Retard > 90 j" value={data ? eur(data.totals.b90) : "—"} />
      </div>

      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un client…" className="pl-9" />
        </div>
        <button
          type="button"
          onClick={() => setOverdueOnly((v) => !v)}
          aria-pressed={overdueOnly}
          className={`h-9 px-3 rounded-md border text-[12.5px] font-semibold transition-colors ${
            overdueOnly ? "border-rose-400/60 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          En retard seulement
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="h-9 px-3 rounded-md border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualiser
        </button>
        {data && <span className="text-[11.5px] text-muted-foreground ml-auto">Base {data.company}</span>}
      </div>

      {/* Mobile : liste de cartes (client + encours en gros, détail au tap) */}
      <div className="md:hidden space-y-2.5">
        {loading ? (
          <div className="h-32 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-10 text-[15px]">Aucun encours 🎉</p>
        ) : rows.map((c) => (
          <button
            key={c.cardCode}
            type="button"
            onClick={() => setDrill(c)}
            className="w-full rounded-2xl border border-border bg-card p-4 text-left active:bg-secondary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono font-semibold text-[16px] text-foreground leading-tight">{c.cardCode}</div>
                <div className="text-[13px] text-muted-foreground truncate">{c.cardName}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[20px] font-bold tnum leading-none text-foreground">{eur(c.encours)}</div>
                <div className="text-[12px] text-muted-foreground mt-1">{c.countOpen} fact.</div>
              </div>
            </div>
            {c.countLate > 0 && (
              <div className="flex items-center gap-2 mt-2.5">
                {c.b90 > 0 && (
                  <span className="inline-flex items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2.5 h-6 text-[12px] font-bold tnum">
                    +90 j · {eur(c.b90)}
                  </span>
                )}
                <span className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 h-6 text-[12px] font-semibold tnum">
                  {c.maxOverdueDays} j de retard
                </span>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Table (desktop) */}
      <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary/40 text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <SortTh label="Client" k="cardName" sort={sort} onSort={onSort} align="left" />
                <SortTh label="Encours net" k="encours" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Nb fact." k="countOpen" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Retard 30-45 j" k="b3045" sort={sort} onSort={onSort} align="right" />
                <SortTh label="45-90 j" k="b4590" sort={sort} onSort={onSort} align="right" />
                <SortTh label="> 90 j" k="b90" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Fact. retard" k="countLate" sort={sort} onSort={onSort} align="right" />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={8} className="h-32 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="h-32 text-center text-muted-foreground">Aucun encours 🎉</td></tr>
              ) : rows.map((c) => (
                <EncoursRow key={c.cardCode} c={c} onSelect={setDrill} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!loading && data && (
        <p className="hidden md:block text-[12px] text-muted-foreground">
          {rows.length} client(s) · {data.totals.clients} débiteurs · {data.totals.invoices} factures · <b className="text-rose-600 dark:text-rose-400">{eur(data.totals.overdueTotal)} en retard (brut)</b>{data.totals.encaisse > 0 && <> · <span className="text-emerald-600 dark:text-emerald-400">{eur(data.totals.encaisse)} encaissé</span></>}{data.totals.avoirsAttribues > 0 && <> · <span className="text-violet-600 dark:text-violet-400">{eur(data.totals.avoirsAttribues)} avoirs</span></>} · clic = détail des factures.
        </p>
      )}

      {drill && (
        <InvoicesModal
          client={drill}
          onClose={() => setDrill(null)}
          onRelance={(c) => { setDrill(null); setRelance(c); }}
        />
      )}
      {relance && (
        <RelanceDialog
          cardCode={relance.cardCode}
          cardName={relance.cardName}
          // Vrai retard max (jours/échéance, NON borné par la grâce de 30 j de
          // l'encours) → suggestion de niveau R0→R5 correcte dès J+8.
          maxOverdueDays={relance.invoices.reduce((m, i) => Math.max(m, i.overdueDays), 0)}
          onClose={() => setRelance(null)}
          onSent={load}
        />
      )}
    </div>
  );
}

/* ── Détail des factures d'un client ─────────────────────── */
function InvoicesModal({ client, onClose, onRelance }: { client: ClientEncours; onClose: () => void; onRelance: (c: ClientEncours) => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Portal vers <body> : sinon un ancêtre transformé (animate-fade-up) "capture"
  // le position:fixed et la modale s'affiche tout en bas au lieu d'être centrée.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-6" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] sm:max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold tracking-tight text-foreground truncate">{client.cardName}</h2>
            <p className="text-[12px] text-muted-foreground">
              <span className="font-mono">{client.cardCode}</span> · encours net <b className="text-foreground">{eurExact(client.encours)}</b>
              {" · "}{client.countOpen} facture(s){client.countLate > 0 && <> · <span className="text-rose-600 dark:text-rose-400 font-semibold">{client.countLate} en retard</span></>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onRelance(client)}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-brand-600 text-white text-[12px] font-semibold hover:bg-brand-700"
            >
              <Send className="h-3.5 w-3.5" /> Relancer
            </button>
            {client.clientId && (
              <Link href={`/clients/${client.clientId}`} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" /> Fiche
              </Link>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground"><X className="h-4 w-4" /></button>
          </div>
        </header>

        {/* Ligne globale de déduction : encaissements (payés) ET avoirs attribués
            sont maintenant DISTINGUÉS. Les avoirs rattachés à une facture sont
            affichés sous leur facture (case dédiée) ; ce qui reste en global =
            paiements + avoirs non affectés à une facture précise. */}
        {(client.encaisse > 0 || client.avoirsAttribues > 0) && (
          <div className="shrink-0 px-5 py-2 text-[12px] border-b border-border bg-emerald-50/40 dark:bg-emerald-950/15 text-foreground">
            Factures (brut) <b>{eurExact(client.brut)}</b>
            {client.encaisse > 0 && (
              <> − encaissements <b className="text-emerald-600 dark:text-emerald-400">{eurExact(client.encaisse)}</b></>
            )}
            {client.avoirsAttribues > 0 && (
              <> − avoirs <b className="text-violet-600 dark:text-violet-400">{eurExact(client.avoirsAttribues)}</b></>
            )}
            {" = net dû "}<b>{eurExact(client.encours)}</b>
          </div>
        )}

        {/* Résumé paliers (au brut) */}
        <div className="shrink-0 grid grid-cols-3 gap-2 px-5 py-3 border-b border-border">
          <MiniStat label="Retard 30-45 j" value={eurOrDash(client.b3045)} tone="amber" />
          <MiniStat label="Retard 45-90 j" value={eurOrDash(client.b4590)} tone="rose" />
          <MiniStat label="Retard > 90 j" value={eurOrDash(client.b90)} tone="rose" />
        </div>

        <div className="flex-1 overflow-auto">
          {(client.encaisse > 0 || client.avoirsAttribues > 0) && (
            <p className="px-4 py-2 text-[11.5px] text-muted-foreground border-b border-border bg-secondary/20">
              Chaque facture montre son <b>solde brut</b>, ses <b>avoirs rattachés</b> (en retrait) puis son <b>total net</b>.
              {client.encaisse > 0 && <> Les encaissements non affectés ({eurExact(client.encaisse)}) restent déduits globalement.</>}
            </p>
          )}
          {/* ── MOBILE : cartes par facture (le tableau 5 colonnes débordait) ── */}
          <div className="md:hidden p-3 space-y-2.5">
            {client.invoices.map((inv) => {
              const late = inv.overdueDays > 30;
              const hasAvoirs = inv.avoirs.length > 0;
              return (
                <div key={inv.docEntry} className={`rounded-xl border p-3 ${late ? "border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/15" : "border-border bg-card"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-[15px] text-foreground">{inv.docNum ?? inv.docEntry}</span>
                      <div className="text-[12px] text-muted-foreground mt-0.5 tnum">
                        {frDate(inv.docDate)} · éch. {frDate(inv.dueDate)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold tnum text-[16px] text-foreground">{eurExact(inv.balance)}</div>
                      {inv.overdueDays > 30
                        ? <div className={`text-[12px] font-semibold ${inv.overdueDays >= 90 ? "text-rose-600 dark:text-rose-400" : inv.overdueDays >= 45 ? "text-rose-500 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>{inv.overdueDays} j de retard</div>
                        : <div className="text-[12px] text-muted-foreground/60">à jour</div>}
                    </div>
                  </div>
                  {hasAvoirs && (
                    <div className="mt-2 pt-2 border-t border-border/60 space-y-1">
                      {inv.avoirs.map((av) => (
                        <div key={av.docEntry} className="flex items-center justify-between gap-2 text-[12.5px] text-violet-600 dark:text-violet-400">
                          <span>↳ AV {av.docNum ?? av.docEntry}{av.docDate && <span className="text-muted-foreground"> · {frDate(av.docDate)}</span>}</span>
                          <span className="tnum font-medium">−{eurExact(av.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2 pt-1 text-[13px]">
                        <span className="uppercase tracking-wide text-[10.5px] font-semibold text-muted-foreground">Total net</span>
                        <span className="font-bold tnum text-foreground">{eurExact(inv.net)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── DESKTOP : tableau détaillé ── */}
          <table className="hidden md:table w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-card text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">N° facture</th>
                <th className="text-left px-4 py-2 font-semibold">Date</th>
                <th className="text-left px-4 py-2 font-semibold">Échéance</th>
                <th className="text-right px-4 py-2 font-semibold">Montant</th>
                <th className="text-right px-4 py-2 font-semibold">Retard</th>
              </tr>
            </thead>
            {/* Une « case » par facture (tbody) : facture + avoirs en retrait + TOTAL. */}
            {client.invoices.map((inv) => {
              const late = inv.overdueDays > 30;
              const hasAvoirs = inv.avoirs.length > 0;
              return (
                <tbody key={inv.docEntry} className="border-b-2 border-border/70">
                  {/* Ligne facture (solde brut) */}
                  <tr className={late ? "bg-rose-50/40 dark:bg-rose-950/15" : ""}>
                    <td className="px-4 pt-2 pb-1 font-mono font-semibold text-foreground">{inv.docNum ?? inv.docEntry}</td>
                    <td className="px-4 pt-2 pb-1 text-muted-foreground">{frDate(inv.docDate)}</td>
                    <td className="px-4 pt-2 pb-1 text-muted-foreground">{frDate(inv.dueDate)}</td>
                    <td className="px-4 pt-2 pb-1 text-right font-semibold tnum text-foreground">{eurExact(inv.balance)}</td>
                    <td className="px-4 pt-2 pb-1 text-right tnum">
                      {inv.overdueDays > 30
                        ? <span className={`font-semibold ${inv.overdueDays >= 90 ? "text-rose-600 dark:text-rose-400" : inv.overdueDays >= 45 ? "text-rose-500 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>{inv.overdueDays} j</span>
                        : <span className="text-muted-foreground/50">à jour</span>}
                    </td>
                  </tr>
                  {/* Avoirs rattachés — imbriqués SOUS la facture, en retrait */}
                  {inv.avoirs.map((av) => (
                    <tr key={av.docEntry} className={late ? "bg-rose-50/40 dark:bg-rose-950/15" : ""}>
                      <td className="px-4 py-0.5 text-violet-600 dark:text-violet-400" colSpan={3}>
                        <span className="pl-4">↳ AV {av.docNum ?? av.docEntry}</span>
                        {av.docDate && <span className="text-muted-foreground"> · {frDate(av.docDate)}</span>}
                      </td>
                      <td className="px-4 py-0.5 text-right tnum font-medium text-violet-600 dark:text-violet-400">−{eurExact(av.amount)}</td>
                      <td className="px-4 py-0.5" />
                    </tr>
                  ))}
                  {/* TOTAL facture (net = solde − avoirs) — seulement s'il y a des avoirs */}
                  {hasAvoirs && (
                    <tr className={late ? "bg-rose-50/40 dark:bg-rose-950/15" : ""}>
                      <td className="px-4 pt-1 pb-2 text-[10.5px] uppercase tracking-wide font-semibold text-muted-foreground" colSpan={3}>
                        <span className="pl-4">Total facture</span>
                      </td>
                      <td className="px-4 pt-1 pb-2 text-right font-bold tnum text-foreground border-t border-border/60">{eurExact(inv.net)}</td>
                      <td className="px-4 pt-1 pb-2 border-t border-border/60" />
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SortTh({
  label, k, sort, onSort, align,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  align: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th
      className={`px-3 py-2.5 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-foreground transition-colors ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-foreground" : ""}`}
      >
        {label}
        <span className="text-[8px] w-2">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "amber" | "rose" }) {
  const cls = tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={`text-[16px] font-bold tnum mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; tone: "brand" | "rose" | "amber" | "violet";
}) {
  const toneCls = {
    brand: "text-brand-600 dark:text-brand-400",
    rose: "text-rose-600 dark:text-rose-400",
    amber: "text-amber-600 dark:text-amber-400",
    violet: "text-violet-600 dark:text-violet-400",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-muted-foreground font-semibold">
        <Icon className={`h-3.5 w-3.5 ${toneCls}`} /> {label}
      </div>
      <div className="text-[24px] font-bold tnum text-foreground mt-0.5">{value}</div>
    </div>
  );
}
