"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, RefreshCw, AlertTriangle, Search, ExternalLink, X, Send, Mail, Plus, Trash2, Inbox, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard, type Accent } from "@/components/ui/surface-card";
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

type SortKey = "cardName" | "encours" | "countOpen" | "retard" | "countLate";

const eur = (n: number) =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)} k€` : `${Math.round(n)} €`;
const eurOrDash = (n: number) => (n > 0 ? eur(n) : "—");
/** Montant exact au centime — pour le DÉTAIL des encours (jamais arrondi). */
const eurExact = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const frDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

/** Total brut en retard, toutes tranches confondues. */
const retardTotal = (c: ClientEncours) => c.b3045 + c.b4590 + c.b90;

/** Sévérité du retard → pastille + teinte. La couleur ne code QUE l'état :
 *  ambre (≤ 45 j) · rose (45-90 j) · rouge (> 90 j). */
function retardSeverity(c: ClientEncours): { total: number; dot: string; text: string; band: string } | null {
  const total = retardTotal(c);
  if (total <= 0) return null;
  if (c.b90 > 0) return { total, dot: "bg-rose-600", text: "text-rose-600 dark:text-rose-400 font-bold", band: "> 90 j" };
  if (c.b4590 > 0) return { total, dot: "bg-rose-500", text: "text-rose-500 dark:text-rose-400 font-semibold", band: "45-90 j" };
  return { total, dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400 font-semibold", band: "≤ 45 j" };
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Ligne mémoïsée : la recherche/tri ne re-rend QUE les lignes dont les props
 *  changent. Une SEULE affordance de clic par ligne : le détail (toute la ligne). */
const EncoursRow = memo(function EncoursRow({ c, onSelect }: { c: ClientEncours; onSelect: (c: ClientEncours) => void }) {
  const sev = retardSeverity(c);
  return (
    <tr className="hover:bg-secondary/40 transition-colors cursor-pointer" onClick={() => onSelect(c)}>
      <td className="px-3 py-2">
        <div className="font-mono font-semibold text-foreground">{c.cardCode}</div>
        <div className="text-caption2 text-muted-foreground truncate max-w-[220px]">{c.cardName}</div>
      </td>
      <td className="px-3 py-2 text-right font-bold tnum text-foreground">{eur(c.encours)}</td>
      <td className="px-3 py-2 text-right tnum text-muted-foreground">{c.countOpen}</td>
      <td className="px-3 py-2 text-right">
        {sev ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            <span className={cn("h-2 w-2 rounded-full shrink-0", sev.dot)} title={`Retard ${sev.band}`} />
            <span className={cn("tnum", sev.text)}>{eur(sev.total)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tnum">{c.countLate > 0 ? <span className="font-semibold text-rose-600 dark:text-rose-400">{c.countLate}</span> : <span className="text-muted-foreground/40">—</span>}</td>
    </tr>
  );
});
EncoursRow.displayName = "EncoursRow";

/** Sépare la chaîne emailCompta (« a@x, b@y ») en liste nettoyée. */
function splitComptaEmails(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
}

/** Indicateur Oui/Non cliquable → ouvre la popup d'édition des emails compta. */
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
      className={cn(
        "inline-flex items-center gap-1 h-6 px-2 rounded-full text-caption font-semibold cursor-pointer transition-colors",
        has
          ? "bg-success/12 text-success ring-1 ring-success/25 hover:bg-success/20"
          : "bg-secondary text-muted-foreground ring-1 ring-border hover:bg-secondary/70",
      )}
    >
      <Mail className="h-3 w-3" />
      {has ? (emails.length > 1 ? `Oui · ${emails.length}` : "Oui") : "Non"}
    </span>
  );
}

/** Popup d'édition des emails compta (destinataires des relances). */
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
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-modal w-full max-w-md overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-callout font-semibold tracking-tight text-foreground truncate flex items-center gap-2">
              <Mail className="h-4 w-4 text-brand-600 dark:text-brand-400" /> Email(s) compta
            </h2>
            <p className="text-caption text-muted-foreground truncate">
              <span className="font-mono">{client.cardCode}</span> · {client.cardName}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="px-5 py-4 space-y-3">
          {disabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <p className="text-caption text-foreground">
                Aucune fiche client locale pour ce débiteur — impossible d&apos;enregistrer un email compta ici.
              </p>
            </div>
          ) : (
            <>
              <p className="text-caption text-muted-foreground">
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
                      className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-secondary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1.5 text-caption font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter un email
              </button>
            </>
          )}
        </div>

        <footer className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" onClick={save} disabled={disabled || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Enregistrer
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function Encours() {
  const [data, setData] = useState<EncoursData | null>(null);
  const [loading, setLoading] = useState(true);
  // Filtre de retard MULTI-SÉLECTION : ensemble de tranches cochées
  // indépendamment. Vide = aucun filtre (tous les clients). « aterme » = pas de
  // facture en retard ; b3045 = retard ≤ 45 j ; b4590 = 45-90 j ; b90 = > 90 j.
  const [bands, setBands] = useState<Set<"aterme" | "b3045" | "b4590" | "b90">>(new Set());
  const toggleBand = useCallback((b: "aterme" | "b3045" | "b4590" | "b90") => {
    setBands((prev) => { const n = new Set(prev); n.has(b) ? n.delete(b) : n.add(b); return n; });
  }, []);
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
      // Multi-sélection (OR) : un client passe s'il correspond à AU MOINS une
      // tranche cochée. Set vide → pas de filtre.
      .filter((c) => bands.size === 0
        || (bands.has("aterme") && c.countLate === 0)
        || (bands.has("b3045") && c.b3045 > 0)
        || (bands.has("b4590") && c.b4590 > 0)
        || (bands.has("b90") && c.b90 > 0))
      .filter((c) => !q || c.cardName.toLowerCase().includes(q) || c.cardCode.toLowerCase().includes(q));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) =>
      sort.key === "cardName"
        ? dir * a.cardName.localeCompare(b.cardName, "fr")
        : sort.key === "retard"
        ? dir * (retardTotal(a) - retardTotal(b))
        : dir * ((a[sort.key] as number) - (b[sort.key] as number)),
    );
  }, [data, bands, debSearch, sort]);

  // Détail à jour : si la relance/compta a été modifiée pendant l'ouverture,
  // on relit la version fraîche depuis `data` pour la modale de détail.
  const drillFresh = useMemo(
    () => (drill && data ? data.clients.find((c) => c.cardCode === drill.cardCode) ?? drill : drill),
    [drill, data],
  );

  return (
    <div className="space-y-4">
      {/* KPIs — zone de PRISE D'INFO : cartes teintées CLIQUABLES (filtres). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi accent="brand" label="Encours total" value={data ? eur(data.totals.encours) : null}
          active={bands.size === 0} onClick={() => setBands(new Set())} />
        <Kpi accent="amber" label="Retard ≤ 45 j" value={data ? eur(data.totals.b3045) : null}
          active={bands.has("b3045")} onClick={() => toggleBand("b3045")} />
        <Kpi accent="rose" label="Retard 45-90 j" value={data ? eur(data.totals.b4590) : null}
          active={bands.has("b4590")} onClick={() => toggleBand("b4590")} />
        <Kpi accent="rose" label="Retard > 90 j" value={data ? eur(data.totals.b90) : null}
          active={bands.has("b90")} onClick={() => toggleBand("b90")} />
      </div>

      {/* Données partielles : au moins un lot de soldes/avoirs SAP a échoué */}
      {data?.partial && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-caption text-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
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
        {/* Filtres de retard multi-sélection — cocher indépendamment une ou
            plusieurs tranches (OR). « Tout » réaffiche l'ensemble. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { key: "aterme", label: "À terme" },
            { key: "b3045", label: "≤ 45 j" },
            { key: "b4590", label: "45-90 j" },
            { key: "b90", label: "> 90 j" },
          ] as const).map((b) => {
            const on = bands.has(b.key);
            return (
              <button
                key={b.key} type="button" onClick={() => toggleBand(b.key)} aria-pressed={on}
                className={`h-9 rounded-lg px-3 text-caption font-medium transition-colors ring-1 ${
                  on ? "bg-brand-500 text-black ring-brand-500" : "bg-background text-foreground ring-border hover:bg-secondary"
                }`}
              >
                {b.label}
              </button>
            );
          })}
          {bands.size > 0 && (
            <button type="button" onClick={() => setBands(new Set())} className="h-9 rounded-lg px-2.5 text-caption text-muted-foreground hover:text-foreground">
              Tout
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualiser
        </Button>
        {data && <span className="text-caption text-muted-foreground ml-auto">Base {data.company}</span>}
      </div>

      {/* Mobile : liste de cartes (client + encours en gros, détail au tap) */}
      <div className="md:hidden space-y-2.5">
        {loading ? (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
        ) : rows.length === 0 ? (
          <EmptyState icon={Inbox} title="Aucun encours" description="Aucune facture ouverte pour ce filtre." />
        ) : rows.map((c) => {
          const sev = retardSeverity(c);
          return (
            <button
              key={c.cardCode}
              type="button"
              onClick={() => setDrill(c)}
              className="w-full rounded-2xl border border-border bg-card p-4 text-left active:bg-secondary/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono font-semibold text-callout text-foreground leading-tight">{c.cardCode}</div>
                  <div className="text-body text-muted-foreground truncate">{c.cardName}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-title3 font-bold tnum leading-none text-foreground">{eur(c.encours)}</div>
                  <div className="text-caption text-muted-foreground mt-1">{c.countOpen} fact.</div>
                </div>
              </div>
              {sev && (
                <div className="flex items-center gap-2 mt-2.5">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 h-6 text-caption font-semibold tnum", sev.text)}>
                    <span className={cn("h-2 w-2 rounded-full", sev.dot)} /> {eur(sev.total)} · {sev.band}
                  </span>
                  <span className="text-caption text-muted-foreground tnum">{c.maxOverdueDays} j</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Table (desktop) — zone de TRAVAIL sobre : en-têtes gris marqués. */}
      <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead className="bg-secondary/60 text-caption2 uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <SortTh label="Client" k="cardName" sort={sort} onSort={onSort} align="left" />
                <SortTh label="Encours net" k="encours" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Nb fact." k="countOpen" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Retard" k="retard" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Fact. en retard" k="countLate" sort={sort} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                [0, 1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td className="px-3 py-3" colSpan={5}><Skeleton className="h-6 w-full rounded-md" /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={5}><EmptyState icon={Inbox} title="Aucun encours" description="Aucune facture ouverte pour ce filtre." /></td></tr>
              ) : rows.map((c) => (
                <EncoursRow key={c.cardCode} c={c} onSelect={setDrill} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!loading && data && (
        <p className="hidden md:block text-caption text-muted-foreground">
          {rows.length} client(s) · {data.totals.clients} débiteurs · {data.totals.invoices} factures · <b className="text-rose-600 dark:text-rose-400">{eur(data.totals.overdueTotal)} en retard (brut)</b>{data.totals.encaisse > 0 && <> · <span className="text-emerald-600 dark:text-emerald-400">{eur(data.totals.encaisse)} encaissé</span></>}{data.totals.avoirsAttribues > 0 && <> · <span className="text-violet-600 dark:text-violet-400">{eur(data.totals.avoirsAttribues)} avoirs</span></>} · clic = détail des factures.
        </p>
      )}

      {drillFresh && (
        <InvoicesModal
          client={drillFresh}
          onClose={() => setDrill(null)}
          onRelance={(c) => { setDrill(null); setRelance(c); }}
          onEditCompta={setCompta}
          onToggleRelance={toggleRelance}
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
          // Feuille 2 étapes : retour au détail du client.
          onBack={() => { const c = relance; setRelance(null); setDrill(c); }}
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
function InvoicesModal({ client: base, onClose, onRelance, onEditCompta, onToggleRelance }: {
  client: ClientEncours;
  onClose: () => void;
  onRelance: (c: ClientEncours) => void;
  onEditCompta: (c: ClientEncours) => void;
  onToggleRelance: (c: ClientEncours, next: boolean) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Avoirs chargés LAZY (par client) à l'ouverture — jamais bloquant.
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

  // Vue fusionnée : le NET ne bouge pas ; on ventile la déduction et on rattache
  // les avoirs aux factures.
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-modal w-full max-w-3xl max-h-[92vh] sm:max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-title3 font-semibold tracking-tight text-foreground truncate">{client.cardName}</h2>
            <p className="text-caption text-muted-foreground">
              <span className="font-mono">{client.cardCode}</span> · encours net <b className="text-foreground">{eurExact(client.encours)}</b>
              {" · "}{client.countOpen} facture(s){client.countLate > 0 && <> · <span className="text-rose-600 dark:text-rose-400 font-semibold">{client.countLate} en retard</span></>}
              {loadingAv && <> · <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400"><Loader2 className="h-3 w-3 animate-spin" /> chargement factures &amp; avoirs…</span></>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" onClick={() => onRelance(client)}>
              <Send className="h-3.5 w-3.5" /> Relancer
            </Button>
            {client.clientId && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/clients/${client.clientId}`}>
                  <ExternalLink className="h-3.5 w-3.5" /> Fiche
                </Link>
              </Button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground"><X className="h-4 w-4" /></button>
          </div>
        </header>

        {/* Réglages de relance du client — déplacés ici depuis le tableau. */}
        <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 border-b border-border bg-secondary/30">
          <label className="inline-flex items-center gap-2 text-caption text-foreground select-none">
            <input
              type="checkbox"
              checked={client.relanceActive}
              disabled={!client.clientId}
              onChange={(e) => onToggleRelance(client, e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-brand-600 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <span>Relances {client.relanceActive ? "activées" : "désactivées"}{!client.clientId && " (client non importé)"}</span>
          </label>
          <span className="inline-flex items-center gap-2 text-caption text-muted-foreground">
            Email compta <ComptaBadge c={client} onEdit={onEditCompta} />
          </span>
        </div>

        {/* Ligne globale de déduction */}
        {(client.encaisse > 0 || client.avoirsAttribues > 0 || client.avoirsNonImputesTotal > 0) && (
          <div className="shrink-0 px-5 py-2 text-caption border-b border-border bg-emerald-500/5 text-foreground">
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
          {/* Avoirs EN FAVEUR du client, non imputés (bleu) */}
          {client.avoirsNonImputes.length > 0 && (
            <div className="px-4 py-3 border-b border-border bg-sky-500/5">
              <p className="text-caption font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                Avoirs en faveur du client — à déduire d'une prochaine facture
              </p>
              <ul className="mt-1.5 space-y-1">
                {client.avoirsNonImputes.map((avo) => (
                  <li key={avo.docEntry} className="flex items-center justify-between gap-2 text-caption text-sky-700 dark:text-sky-300">
                    <span>AV {avo.docNum ?? avo.docEntry}{avo.docDate && <span className="text-muted-foreground"> · {frDate(avo.docDate)}</span>}</span>
                    <span className="tnum font-semibold">{eurExact(avo.amount)}</span>
                  </li>
                ))}
              </ul>
              {client.avoirsNonImputes.length > 1 && (
                <div className="mt-1.5 pt-1.5 border-t border-border flex items-center justify-between text-caption font-bold text-sky-800 dark:text-sky-200">
                  <span>Total en faveur</span>
                  <span className="tnum">{eurExact(client.avoirsNonImputesTotal)}</span>
                </div>
              )}
            </div>
          )}
          {(client.encaisse > 0 || client.avoirsAttribues > 0) && (
            <p className="px-4 py-2 text-caption text-muted-foreground border-b border-border bg-secondary/20">
              Chaque facture montre son <b>solde brut</b>, ses <b>avoirs rattachés</b> (en retrait) puis son <b>total net</b>.
              {client.encaisse > 0 && <> Les encaissements non affectés ({eurExact(client.encaisse)}) restent déduits globalement.</>}
            </p>
          )}
          {/* ── MOBILE : cartes par facture ── */}
          <div className="md:hidden p-3 space-y-2.5">
            {client.invoices.map((inv) => {
              const late = inv.overdueDays > 0;
              const hasAvoirs = inv.avoirs.length > 0;
              return (
                <div key={inv.docEntry} className={cn("rounded-xl border p-3", late ? "border-rose-300 dark:border-rose-800 bg-rose-500/5" : "border-border bg-card")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-callout text-foreground">{inv.docNum ?? inv.docEntry}</span>
                      <div className="text-caption text-muted-foreground mt-0.5 tnum">
                        {frDate(inv.docDate)} · éch. {frDate(inv.dueDate)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold tnum text-callout text-foreground">{eurExact(inv.balance)}</div>
                      {inv.overdueDays > 0
                        ? <div className={cn("text-caption font-semibold", inv.overdueDays > 90 ? "text-rose-600 dark:text-rose-400" : inv.overdueDays > 45 ? "text-rose-500 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>{inv.overdueDays} j de retard</div>
                        : <div className="text-caption text-muted-foreground/60">à jour</div>}
                    </div>
                  </div>
                  {hasAvoirs && (
                    <div className="mt-2 pt-2 border-t border-border/60 space-y-1">
                      {inv.avoirs.map((avo) => (
                        <div key={avo.docEntry} className="flex items-center justify-between gap-2 text-caption text-violet-600 dark:text-violet-400">
                          <span>↳ AV {avo.docNum ?? avo.docEntry}{avo.docDate && <span className="text-muted-foreground"> · {frDate(avo.docDate)}</span>}</span>
                          <span className="tnum font-medium">−{eurExact(avo.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2 pt-1 text-body">
                        <span className="uppercase tracking-wide text-caption2 font-semibold text-muted-foreground">Total net</span>
                        <span className="font-bold tnum text-foreground">{eurExact(inv.net)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── DESKTOP : tableau détaillé ── */}
          <table className="hidden md:table w-full text-caption">
            <thead className="sticky top-0 z-10 bg-secondary/60 text-caption2 uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">N° facture</th>
                <th className="text-left px-4 py-2 font-semibold">Date</th>
                <th className="text-left px-4 py-2 font-semibold">Échéance</th>
                <th className="text-right px-4 py-2 font-semibold">Montant</th>
                <th className="text-right px-4 py-2 font-semibold">Retard</th>
              </tr>
            </thead>
            {client.invoices.map((inv) => {
              const late = inv.overdueDays > 0;
              const hasAvoirs = inv.avoirs.length > 0;
              return (
                <tbody key={inv.docEntry} className="border-b-2 border-border/70">
                  <tr className={late ? "bg-rose-500/5" : ""}>
                    <td className="px-4 pt-2 pb-1 font-mono font-semibold text-foreground">{inv.docNum ?? inv.docEntry}</td>
                    <td className="px-4 pt-2 pb-1 text-muted-foreground">{frDate(inv.docDate)}</td>
                    <td className="px-4 pt-2 pb-1 text-muted-foreground">{frDate(inv.dueDate)}</td>
                    <td className="px-4 pt-2 pb-1 text-right font-semibold tnum text-foreground">{eurExact(inv.balance)}</td>
                    <td className="px-4 pt-2 pb-1 text-right tnum">
                      {inv.overdueDays > 0
                        ? <span className={cn("font-semibold", inv.overdueDays > 90 ? "text-rose-600 dark:text-rose-400" : inv.overdueDays > 45 ? "text-rose-500 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>{inv.overdueDays} j</span>
                        : <span className="text-muted-foreground/50">à jour</span>}
                    </td>
                  </tr>
                  {inv.avoirs.map((avo) => (
                    <tr key={avo.docEntry} className={late ? "bg-rose-500/5" : ""}>
                      <td className="px-4 py-0.5 text-violet-600 dark:text-violet-400" colSpan={3}>
                        <span className="pl-4">↳ AV {avo.docNum ?? avo.docEntry}</span>
                        {avo.docDate && <span className="text-muted-foreground"> · {frDate(avo.docDate)}</span>}
                      </td>
                      <td className="px-4 py-0.5 text-right tnum font-medium text-violet-600 dark:text-violet-400">−{eurExact(avo.amount)}</td>
                      <td className="px-4 py-0.5" />
                    </tr>
                  ))}
                  {hasAvoirs && (
                    <tr className={late ? "bg-rose-500/5" : ""}>
                      <td className="px-4 pt-1 pb-2 text-caption2 uppercase tracking-wide font-semibold text-muted-foreground" colSpan={3}>
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
      className={cn("px-3 py-2.5 font-semibold", align === "right" ? "text-right" : "text-left")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-foreground transition-colors", align === "right" && "flex-row-reverse", active && "text-foreground")}
      >
        {label}
        {active && (sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "amber" | "rose" }) {
  const cls = tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <div className="text-caption2 uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={cn("text-callout font-bold tnum mt-0.5", cls)}>{value}</div>
    </div>
  );
}

/** Tuile KPI — carte teintée (prise d'info) CLIQUABLE : filtre la liste. */
function Kpi({
  label, value, accent, active, onClick,
}: {
  label: string; value: string | null; accent: Accent; active?: boolean; onClick?: () => void;
}) {
  if (value == null) return <Skeleton className="h-[74px] w-full rounded-xl" />;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        "text-left rounded-xl transition-transform duration-[var(--dur-fast)] ease-[var(--ease-apple)] active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      <SurfaceCard tinted accent={accent} animate={false} className="p-4">
        <div className="text-title3 font-bold tnum text-foreground">{value}</div>
        <div className="text-caption2 uppercase tracking-wide text-muted-foreground">{label}</div>
      </SurfaceCard>
    </button>
  );
}
