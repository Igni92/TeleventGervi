"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, RefreshCw, Euro, AlertTriangle, Clock, Flame, Search, ExternalLink, X, Send, Mail, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatBlock } from "@/components/ui/stat-block";
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
  emailCompta: string | null; // destinataire(s) des relances (joint par « , »)
  encours: number;          // NET (paiements + avoirs déduits)
  brut: number;             // somme des factures (avant déduction)
  encaisse: number;         // paiements + avoirs NON affectés (déduit en ligne)
  avoirsAttribues: number;  // avoirs rattachés à une facture (déduit par facture)
  avoirsNonImputes: AttributedAvoir[]; // avoirs en faveur du client, non imputés (bleu)
  avoirsNonImputesTotal: number;
  countOpen: number;
  b3045: number; // ≤ 45 j de retard (brut)
  b4590: number; // 45-90 j (brut)
  b90: number;   // > 90 j (brut)
  countLate: number;
  maxOverdueDays: number;
  invoices: InvoiceLine[];
  /** Relances activées pour ce client ? (case à cocher ; false = ne pas relancer). */
  relanceActive: boolean;
}
interface EncoursData {
  company: string;
  totals: { encours: number; encaisse: number; avoirsAttribues: number; overdueTotal: number; b3045: number; b4590: number; b90: number; invoices: number; clients: number };
  clients: ClientEncours[];
  /** État PARTIEL : au moins un lot de soldes/avoirs SAP a échoué — les encours de
   *  certains clients manquent. Bandeau non bloquant (chiffres sous-estimés). */
  partial?: boolean;
  failedChunks?: number;
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
const EncoursRow = memo(function EncoursRow({ c, onSelect, onEditCompta, onToggleRelance }: { c: ClientEncours; onSelect: (c: ClientEncours) => void; onEditCompta: (c: ClientEncours) => void; onToggleRelance: (c: ClientEncours, next: boolean) => void }) {
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
      <td className="px-3 py-2 text-center">
        <ComptaBadge c={c} onEdit={onEditCompta} />
      </td>
      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
        {/* Activer / désactiver les relances pour ce client (décoché = ne pas relancer). */}
        <input
          type="checkbox"
          checked={c.relanceActive}
          disabled={!c.clientId}
          onChange={(e) => onToggleRelance(c, e.target.checked)}
          title={c.clientId ? (c.relanceActive ? "Relances activées — décocher pour ne plus relancer" : "Relances désactivées pour ce client") : "Client non importé — non modifiable"}
          aria-label={`Relances ${c.relanceActive ? "activées" : "désactivées"} pour ${c.cardName}`}
          className="h-4 w-4 cursor-pointer accent-brand-600 disabled:opacity-40 disabled:cursor-not-allowed"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground"><ExternalLink className="h-3.5 w-3.5" /></span>
      </td>
    </tr>
  );
});
EncoursRow.displayName = "EncoursRow";

/** Sépare la chaîne emailCompta (« a@x, b@y ») en liste nettoyée. */
function splitComptaEmails(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
}

/** Indicateur Oui/Non cliquable → ouvre la popup d'édition des emails compta.
 *  Rendu en <span role="button"> (et non <button>) pour rester valide dans la
 *  carte mobile, elle-même un <button>. Stoppe la propagation pour ne pas ouvrir
 *  la modale de détail de la ligne. */
function ComptaBadge({ c, onEdit }: { c: ClientEncours; onEdit: (c: ClientEncours) => void }) {
  const emails = splitComptaEmails(c.emailCompta);
  const has = emails.length > 0;
  const open = (e: React.SyntheticEvent) => { e.stopPropagation(); onEdit(c); };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); } }}
      title={has ? emails.join(", ") : "Aucun email compta — cliquer pour ajouter"}
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold cursor-pointer transition-colors ${
        has
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
          : "bg-secondary text-muted-foreground hover:bg-secondary/70"
      }`}
    >
      <Mail className="h-3 w-3" />
      {has ? (emails.length > 1 ? `Oui · ${emails.length}` : "Oui") : "Non"}
    </span>
  );
}

/** Popup d'édition des emails compta (destinataires des relances). Un ou
 *  PLUSIEURS emails (liste d'inputs « + ajouter »). Enregistre via
 *  PATCH /api/clients/[id]/compta (stockage joint « , » + push SAP U_ComptaE).
 *  clientId absent (pas de fiche locale) → édition désactivée avec message. */
function ComptaEmailsModal({ client, onClose, onSaved }: { client: ClientEncours; onClose: () => void; onSaved: () => void }) {
  const disabled = !client.clientId;
  const [emails, setEmails] = useState<string[]>(() => {
    const list = splitComptaEmails(client.emailCompta);
    return list.length ? list : [""];
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const setAt = (i: number, v: string) => setEmails((prev) => prev.map((e, idx) => (idx === i ? v : e)));
  const addRow = () => setEmails((prev) => [...prev, ""]);
  const removeRow = (i: number) => setEmails((prev) => (prev.length <= 1 ? [""] : prev.filter((_, idx) => idx !== i)));

  const save = useCallback(async () => {
    if (disabled || !client.clientId) return;
    const cleaned = emails.map((e) => e.trim()).filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const bad = cleaned.find((e) => !emailRe.test(e));
    if (bad) { toast.error(`Email invalide : ${bad}`); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/clients/${client.clientId}/compta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailCompta: cleaned.join(", ") }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Enregistrement impossible"); return; }
      toast.success(cleaned.length ? "Destinataire(s) compta enregistré(s)." : "Email compta effacé.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [disabled, client.clientId, emails, onSaved]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-foreground truncate flex items-center gap-2">
              <Mail className="h-4 w-4 text-brand-600 dark:text-brand-400" /> Email(s) compta
            </h2>
            <p className="text-[11.5px] text-muted-foreground truncate">
              <span className="font-mono">{client.cardCode}</span> · {client.cardName}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="px-5 py-4 space-y-3">
          {disabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/25 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[12px] text-amber-800 dark:text-amber-200">
                Aucune fiche client locale pour ce débiteur — impossible d&apos;enregistrer un email compta ici.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-muted-foreground">
                Destinataire(s) des relances (envoyées depuis <b className="font-mono">compta@gervifrais.com</b>). Un ou plusieurs emails.
              </p>
              <div className="space-y-2">
                {emails.map((email, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setAt(i, e.target.value)}
                      placeholder="compta@client.fr"
                      className="flex-1"
                      autoFocus={i === 0}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      title="Retirer"
                      className="p-2 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-secondary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter un email
              </button>
            </>
          )}
        </div>

        <footer className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-md border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={disabled || saving}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Enregistrer
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function Encours() {
  const [data, setData] = useState<EncoursData | null>(null);
  const [loading, setLoading] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<ClientEncours | null>(null);
  const [relance, setRelance] = useState<ClientEncours | null>(null);
  const [compta, setCompta] = useState<ClientEncours | null>(null);
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

  // Active / désactive les relances d'un client. Mise à jour OPTIMISTE (réponse
  // instantanée), rollback + toast si le PATCH échoue.
  const toggleRelance = useCallback(async (c: ClientEncours, next: boolean) => {
    if (!c.clientId) return;
    setData((prev) => prev && ({
      ...prev,
      clients: prev.clients.map((x) => x.cardCode === c.cardCode ? { ...x, relanceActive: next } : x),
    }));
    try {
      const r = await fetch(`/api/clients/${c.clientId}/compta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relanceActive: next }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Échec de l'enregistrement");
      toast.success(next ? `Relances réactivées — ${c.cardName}` : `Relances désactivées — ${c.cardName}`);
    } catch (e) {
      // rollback
      setData((prev) => prev && ({
        ...prev,
        clients: prev.clients.map((x) => x.cardCode === c.cardCode ? { ...x, relanceActive: !next } : x),
      }));
      toast.error((e as Error).message);
    }
  }, []);

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
        <Kpi icon={AlertTriangle} tone="amber" label="Retard ≤ 45 j" value={data ? eur(data.totals.b3045) : "—"} />
        <Kpi icon={Clock} tone="rose" label="Retard 45-90 j" value={data ? eur(data.totals.b4590) : "—"} />
        <Kpi icon={Flame} tone="rose" label="Retard > 90 j" value={data ? eur(data.totals.b90) : "—"} />
      </div>

      {/* Données partielles : au moins un lot de soldes/avoirs SAP a échoué */}
      {data?.partial && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-900/15 px-4 py-3 text-[12.5px] text-amber-800 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500 dark:text-amber-400" />
          <span>
            <b>Données partielles</b> — les soldes de certains clients n’ont pas pu être lus dans SAP
            {data.failedChunks ? <> ({data.failedChunks} lot{data.failedChunks > 1 ? "s" : ""} en échec)</> : null}.
            Les encours affichés sont <b>sous-estimés</b> : réactualise dans un instant.
          </span>
        </div>
      )}

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
            <div className="flex items-center gap-2 mt-2.5">
              <span className="text-[11.5px] text-muted-foreground">Email compta</span>
              <ComptaBadge c={c} onEdit={setCompta} />
            </div>
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
                <SortTh label="Retard ≤ 45 j" k="b3045" sort={sort} onSort={onSort} align="right" />
                <SortTh label="45-90 j" k="b4590" sort={sort} onSort={onSort} align="right" />
                <SortTh label="> 90 j" k="b90" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Fact. retard" k="countLate" sort={sort} onSort={onSort} align="right" />
                <th className="px-3 py-2.5 font-semibold text-center uppercase tracking-wider">Email compta</th>
                <th className="px-3 py-2.5 font-semibold text-center uppercase tracking-wider" title="Décocher pour ne plus relancer ce client">Relance</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={10} className="h-32 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="h-32 text-center text-muted-foreground">Aucun encours 🎉</td></tr>
              ) : rows.map((c) => (
                <EncoursRow key={c.cardCode} c={c} onSelect={setDrill} onEditCompta={setCompta} onToggleRelance={toggleRelance} />
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
      {compta && (
        <ComptaEmailsModal
          client={compta}
          onClose={() => setCompta(null)}
          onSaved={() => { setCompta(null); load(); }}
        />
      )}
    </div>
  );
}

/** Enrichissement AVOIRS renvoyé par /api/encours/avoirs (chargé à l'ouverture). */
interface LazyAvoirs {
  encaisse: number;
  avoirsAttribues: number;
  avoirsNonImputes: AttributedAvoir[];
  avoirsNonImputesTotal: number;
  invoices: { docEntry: number; avoirs: AttributedAvoir[]; avoirsTotal: number; net: number }[];
}

/* ── Détail des factures d'un client ─────────────────────── */
function InvoicesModal({ client: base, onClose, onRelance }: { client: ClientEncours; onClose: () => void; onRelance: (c: ClientEncours) => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Avoirs chargés LAZY (par client) à l'ouverture — jamais bloquant : en cas
  // d'échec on garde les données de base (aucun avoir affiché).
  const [av, setAv] = useState<LazyAvoirs | null>(null);
  const [loadingAv, setLoadingAv] = useState(true);
  useEffect(() => {
    let alive = true;
    setAv(null);
    setLoadingAv(true);
    fetch(`/api/encours/avoirs?cardCode=${encodeURIComponent(base.cardCode)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && j?.ok) setAv(j as LazyAvoirs); })
      .catch(() => { /* silencieux : la modale reste utilisable sans les avoirs */ })
      .finally(() => { if (alive) setLoadingAv(false); });
    return () => { alive = false; };
  }, [base.cardCode]);

  // Vue fusionnée : le NET ne bouge pas ; on ventile la déduction (règlements /
  // avoirs imputés / avoirs en faveur) et on rattache les avoirs aux factures.
  const client: ClientEncours = useMemo(() => {
    if (!av) return base;
    const byEntry = new Map(av.invoices.map((i) => [i.docEntry, i]));
    return {
      ...base,
      encaisse: av.encaisse,
      avoirsAttribues: av.avoirsAttribues,
      avoirsNonImputes: av.avoirsNonImputes,
      avoirsNonImputesTotal: av.avoirsNonImputesTotal,
      invoices: base.invoices.map((inv) => {
        const e = byEntry.get(inv.docEntry);
        return e ? { ...inv, avoirs: e.avoirs, avoirsTotal: e.avoirsTotal, net: e.net } : inv;
      }),
    };
  }, [base, av]);

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
              {loadingAv && <> · <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400"><Loader2 className="h-3 w-3 animate-spin" /> chargement factures &amp; avoirs…</span></>}
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
        {(client.encaisse > 0 || client.avoirsAttribues > 0 || client.avoirsNonImputesTotal > 0) && (
          <div className="shrink-0 px-5 py-2 text-[12px] border-b border-border bg-emerald-50/40 dark:bg-emerald-950/15 text-foreground">
            Factures (brut) <b>{eurExact(client.brut)}</b>
            {client.encaisse > 0 && (
              <> − encaissements <b className="text-emerald-600 dark:text-emerald-400">{eurExact(client.encaisse)}</b></>
            )}
            {client.avoirsAttribues > 0 && (
              <> − avoirs imputés <b className="text-violet-600 dark:text-violet-400">{eurExact(client.avoirsAttribues)}</b></>
            )}
            {client.avoirsNonImputesTotal > 0 && (
              <> − avoirs en faveur <b className="text-sky-600 dark:text-sky-400">{eurExact(client.avoirsNonImputesTotal)}</b></>
            )}
            {" = net dû "}<b>{eurExact(client.encours)}</b>
          </div>
        )}

        {/* Résumé paliers (au brut) */}
        <div className="shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-2 px-5 py-3 border-b border-border">
          <MiniStat label="Retard ≤ 45 j" value={eurOrDash(client.b3045)} tone="amber" />
          <MiniStat label="Retard 45-90 j" value={eurOrDash(client.b4590)} tone="rose" />
          <MiniStat label="Retard > 90 j" value={eurOrDash(client.b90)} tone="rose" />
        </div>

        <div className="flex-1 overflow-auto">
          {/* Avoirs EN FAVEUR du client, non imputés à une facture (bleu) : nous les
              lui devons ; ils viendront en déduction d'une facture ultérieure. */}
          {client.avoirsNonImputes.length > 0 && (
            <div className="px-4 py-3 border-b border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20">
              <p className="text-[11.5px] font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                Avoirs en faveur du client — à déduire d'une prochaine facture
              </p>
              <ul className="mt-1.5 space-y-1">
                {client.avoirsNonImputes.map((av) => (
                  <li key={av.docEntry} className="flex items-center justify-between gap-2 text-[12.5px] text-sky-700 dark:text-sky-300">
                    <span>AV {av.docNum ?? av.docEntry}{av.docDate && <span className="text-muted-foreground"> · {frDate(av.docDate)}</span>}</span>
                    <span className="tnum font-semibold">{eurExact(av.amount)}</span>
                  </li>
                ))}
              </ul>
              {client.avoirsNonImputes.length > 1 && (
                <div className="mt-1.5 pt-1.5 border-t border-sky-200/70 dark:border-sky-900/60 flex items-center justify-between text-[12.5px] font-bold text-sky-800 dark:text-sky-200">
                  <span>Total en faveur</span>
                  <span className="tnum">{eurExact(client.avoirsNonImputesTotal)}</span>
                </div>
              )}
            </div>
          )}
          {(client.encaisse > 0 || client.avoirsAttribues > 0) && (
            <p className="px-4 py-2 text-[11.5px] text-muted-foreground border-b border-border bg-secondary/20">
              Chaque facture montre son <b>solde brut</b>, ses <b>avoirs rattachés</b> (en retrait) puis son <b>total net</b>.
              {client.encaisse > 0 && <> Les encaissements non affectés ({eurExact(client.encaisse)}) restent déduits globalement.</>}
            </p>
          )}
          {/* ── MOBILE : cartes par facture (le tableau 5 colonnes débordait) ── */}
          <div className="md:hidden p-3 space-y-2.5">
            {client.invoices.map((inv) => {
              const late = inv.overdueDays > 0;   // en retard dès l'échéance dépassée (comme les totaux)
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
                      {inv.overdueDays > 0
                        ? <div className={`text-[12px] font-semibold ${inv.overdueDays > 90 ? "text-rose-600 dark:text-rose-400" : inv.overdueDays > 45 ? "text-rose-500 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>{inv.overdueDays} j de retard</div>
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
              const late = inv.overdueDays > 0;   // en retard dès l'échéance dépassée (comme les totaux)
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
                      {inv.overdueDays > 0
                        ? <span className={`font-semibold ${inv.overdueDays > 90 ? "text-rose-600 dark:text-rose-400" : inv.overdueDays > 45 ? "text-rose-500 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>{inv.overdueDays} j</span>
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

/** Tuile KPI locale — délègue la typo au StatBlock partagé (dédoublonnage). */
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
      <StatBlock
        label={<span className="inline-flex items-center gap-1.5"><Icon className={`h-3.5 w-3.5 ${toneCls}`} /> {label}</span>}
        value={value}
      />
    </div>
  );
}
