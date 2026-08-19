"use client";

/**
 * VENTES DU JOUR — les ventes SAISIES aujourd'hui (jour où la commande est
 * RENTRÉE dans le système, = DocDate), quelle que soit leur date de livraison.
 * Consultation seule, groupée par TRANSPORTEUR — 5e onglet de la famille
 * « Livraisons du jour » (LivraisonsSectionTabs).
 *
 * Pour chaque BL, l'avancement est porté par UNE pilule de progression à
 * trois crans (saisi → préparé → parti), cohérente avec les états de
 * /livraisons (Fait = vert succès, Départ = bleu info).
 *
 * Les BL « avoir / exclu » ne sont pas des ventes → masqués de cet état.
 * (La mise en préparation / le suivi de picking vivent dans le Détail livraison.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock, Hash, Inbox, Loader2, Pencil, RefreshCw, Search, ShieldAlert, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatLine } from "@/components/ui/stat-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DesignationStrong, DesignationMuted } from "@/components/livraisons/ArticleDesignation";
import { broadcastActiveClient } from "@/lib/consoleSync";
import { BLViewDialog } from "@/components/livraisons/BLViewDialog";
import type { ApiResp, Doc } from "@/lib/livraisonView";
// Couleurs de segment : source unique du design system (GMS teal · CHR amber · EXPORT violet).
import { SEGMENT_BADGE } from "@/lib/segments";
import type { SafeguardViolation } from "@/lib/safeguards";

/** Date murale Europe/Paris (le poste peut être ailleurs) — « aujourd'hui » métier. */
function parisTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
/** « lun. 7 juil. » court, depuis un ISO (date de livraison par BL). */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}

const DOW_ABBR = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];
/** « LUN 27.07.26 » compact — modale de détail BL (en-tête). */
function blDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${DOW_ABBR[dt.getUTCDay()]} ${p2(d)}.${p2(m)}.${String(y).slice(-2)}`;
}
/** « Ventes du MER 29.07.26 à 5h17 » — en-tête de la liste, heure courante
 *  (rendu au moment du chargement/rafraîchissement). */
function venteHeaderLabel(iso: string): string {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `Ventes du ${blDateLabel(iso)} à ${now.getHours()}h${p2(now.getMinutes())}`;
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });


interface Group { key: string; name: string; docs: Doc[] }

/** Ventes groupées par transporteur (ordre API : colis desc, « Non affecté » en
 *  dernier), hors « avoir / exclu », triées par magasin. */
function toGroups(data: ApiResp | null): Group[] {
  if (!data?.ok) return [];
  return data.carriers
    .map((c) => ({
      key: c.code ?? "__none__",
      name: c.name,
      docs: c.docs.filter((d) => !d.excluded).sort((a, b) => a.cardName.localeCompare(b.cardName, "fr")),
    }))
    .filter((g) => g.docs.length > 0);
}

export function VentesDuJour() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  // GARDE-FOUS (Paramètres) — anomalies détectées a posteriori sur les ventes
  // du jour (vente à perte, volume inhabituel, doublon…), par docEntry.
  const [alerts, setAlerts] = useState<Record<number, SafeguardViolation[]>>({});
  const today = useMemo(() => parisTodayISO(), []);
  // BL ouvert dans le dialog (visuel/édition). `edit` = ouverture directe en
  // modification (clic droit sur la ligne ou bouton stylo).
  const [blOpen, setBlOpen] = useState<{ docEntry: number; docNum: number; cardName: string; edit: boolean } | null>(null);
  const openBL = useCallback((d: Doc, edit: boolean) => {
    setBlOpen({ docEntry: d.docEntry, docNum: d.docNum, cardName: d.cardFullName ?? d.cardName, edit });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Ventes SAISIES aujourd'hui (DocDate) — mode `entered` de l'API — et,
      // en parallèle, le scan garde-fous du même jour (miroir local, best-effort).
      const [r, rScan] = await Promise.all([
        fetch(`/api/livraisons?entered=${today}`, { cache: "no-store" }),
        fetch(`/api/safeguards/scan-ventes?date=${today}`, { cache: "no-store" }).catch(() => null),
      ]);
      const j = await r.json().catch(() => null);
      if (j?.ok) setData(j); else toast.error(j?.error || "Ventes du jour indisponibles");
      const jScan = rScan ? await rScan.json().catch(() => null) : null;
      setAlerts(jScan?.ok ? (jScan.violations ?? {}) : {});
    } catch {
      toast.error("SAP injoignable — ventes du jour non chargées");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  // Total NON filtré (ignore la recherche) — distingue « aucune vente saisie
  // aujourd'hui » (EmptyState) de « la recherche ne matche rien » (texte discret).
  const allDocsCount = useMemo(
    () => toGroups(data).reduce((s, g) => s + g.docs.length, 0),
    [data],
  );
  const groups = useMemo(() => {
    const base = toGroups(data);
    if (!needle) return base;
    return base
      .map((g) => ({ ...g, docs: g.docs.filter((d) =>
        d.cardName.toLowerCase().includes(needle) ||
        (d.cardFullName ?? "").toLowerCase().includes(needle) ||
        String(d.docNum).includes(needle)) }))
      .filter((g) => g.docs.length > 0);
  }, [data, needle]);

  const docs = useMemo(() => groups.flatMap((g) => g.docs), [groups]);
  const ca = docs.reduce((s, d) => s + d.totalHT, 0);
  const prepared = docs.filter((d) => d.prepared || d.departed).length;
  const departed = docs.filter((d) => d.departed).length;
  const alerted = docs.filter((d) => (alerts[d.docEntry]?.length ?? 0) > 0).length;

  return (
    <div className="space-y-4">
      {/* Bandeau : recherche + rafraîchissement */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par magasin ou n° de BL…"
            aria-label="Filtrer les ventes"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-body focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-border bg-card text-caption font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:bg-secondary transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* En-tête de la liste : titre + badge d'alertes (ambre, seulement si > 0)
            et synthèse StatLine (« 41 ventes · 12 480 € HT · 30/41 préparées ·
            8 parties »). Basée sur les docs FILTRÉS : la recherche met les
            compteurs à jour sans les faire disparaître. */}
        <div className="px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2 flex-wrap">
            <Store className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={2} />
            <p className="text-body font-semibold text-foreground leading-tight">
              {venteHeaderLabel(data?.date ?? today)}
            </p>
            <span className="text-caption text-muted-foreground">groupées par transporteur</span>
            {/* GARDE-FOUS — badge ambre seulement quand il y a des anomalies. */}
            {!loading && alerted > 0 && (
              <Badge variant="planifie" className="ml-auto inline-flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" />
                {alerted} alerte{alerted > 1 ? "s" : ""} garde-fous
              </Badge>
            )}
          </div>
          {!loading && allDocsCount > 0 && (
            <StatLine
              className="mt-3"
              items={[
                { value: docs.length.toLocaleString("fr-FR"), label: `vente${docs.length > 1 ? "s" : ""}` },
                { value: eur.format(ca), label: "CA HT" },
                { value: `${prepared}/${docs.length}`, label: "préparées" },
                { value: departed.toLocaleString("fr-FR"), label: `partie${departed > 1 ? "s" : ""}` },
              ]}
            />
          )}
        </div>

        {loading ? (
          // A — mise à jour en cours : squelette de liste (le texte accessible
          // est porté par le role="status", les blocs Skeleton sont décoratifs).
          <div role="status" aria-label="Chargement des ventes du jour">
            <div className="px-4 sm:px-5 py-2 border-b border-border/60 bg-secondary/20">
              <Skeleton className="h-3 w-32 rounded" />
            </div>
            <ul className="divide-y divide-border/60">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-48 max-w-full rounded" />
                    <Skeleton className="h-3 w-64 max-w-full rounded" />
                  </div>
                  <Skeleton className="h-7 w-28 rounded-full shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        ) : allDocsCount === 0 ? (
          // B — aucune vente saisie aujourd'hui : état vide standard.
          <EmptyState
            icon={Inbox}
            title="Aucune vente pour le moment"
            description="Les commandes saisies aujourd'hui apparaîtront ici au fil de la journée."
          />
        ) : groups.length === 0 ? (
          // Recherche active sans résultat (des ventes existent, filtrées à 0) —
          // cas distinct de « B » : texte discret, les compteurs restent visibles.
          <p className="px-5 py-6 text-body text-muted-foreground text-center">
            Aucune vente saisie aujourd&apos;hui pour cette recherche.
          </p>
        ) : (
          // C — des ventes : liste groupée par transporteur.
          groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 px-4 sm:px-5 py-1.5 bg-secondary/20 border-y border-border/60">
                <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-caption2 font-bold uppercase tracking-wide text-muted-foreground truncate">{g.name}</span>
                <span className="text-caption2 tnum text-muted-foreground/70">{g.docs.length}</span>
              </div>
              <ul className="divide-y divide-border/60">
                {g.docs.map((d) => <VenteRow key={d.docEntry} d={d} alerts={alerts[d.docEntry]} onOpenBL={openBL} />)}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* Édition d'un BL (clic droit sur la ligne ou stylo). */}
      <BLViewDialog
        docEntry={blOpen?.docEntry ?? null}
        docNum={blOpen?.docNum ?? null}
        cardName={blOpen?.cardName ?? ""}
        open={!!blOpen}
        startEdit={blOpen?.edit ?? false}
        onOpenChange={(v) => { if (!v) setBlOpen(null); }}
        onSaved={load}
      />
    </div>
  );
}

/** Avancement à TROIS CRANS — saisi → préparé → parti. Pilule NEUTRE (fond
 *  secondaire, filet border) : seuls les crans atteints et le libellé prennent
 *  la couleur de l'état courant, cohérente avec les onglets de /livraisons
 *  (Fait = vert succès, Départ = bleu info ; « saisi » reste muted). */
function ProgressPill({ prepared, departed }: { prepared: boolean; departed: boolean }) {
  const step = departed ? 3 : prepared ? 2 : 1;
  const label = departed ? "Parti" : prepared ? "Préparé" : "Saisi";
  const fill = departed ? "bg-info" : prepared ? "bg-success" : "bg-muted-foreground/50";
  const text = departed ? "text-info" : prepared ? "text-success" : "text-muted-foreground";
  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-secondary/40 px-2.5 shrink-0"
      title={`Avancement ${step}/3 : saisi → préparé → parti`}
      aria-label={`Avancement : ${label} (étape ${step} sur 3)`}
    >
      <span className="flex items-center gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-3.5 rounded-full transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] ${
              i <= step ? fill : "bg-border"
            }`}
          />
        ))}
      </span>
      <span className={`text-caption font-semibold ${text}`}>{label}</span>
    </span>
  );
}

/** Ligne de vente — un BL (magasin). UNE affordance de clic : la zone
 *  principale ouvre le DÉTAIL du BL ; la modification passe par le stylo
 *  visible (le clic droit reste un raccourci vers la même édition).
 *  `alerts` = anomalies garde-fous détectées a posteriori (badge + détail dépliable). */
function VenteRow({ d, alerts, onOpenBL }: { d: Doc; alerts?: SafeguardViolation[]; onOpenBL: (d: Doc, edit: boolean) => void }) {
  const takenTime = d.takenAt ? d.takenAt.slice(11, 16) : null;
  const [showAlerts, setShowAlerts] = useState(false);
  // Détail BL (modale plein écran mobile) — toutes les lignes sont déjà en main
  // (mêmes données que la liste), pas d'appel réseau supplémentaire.
  const [detailOpen, setDetailOpen] = useState(false);
  // N° de commande client (réf. NumAtCard) — éditable ici, enregistré sur le BL SAP.
  const [num, setNum] = useState(d.numAtCard ?? "");
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(d.numAtCard ?? "");

  const saveNum = useCallback(async () => {
    const v = num.trim();
    if (v === savedRef.current) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/sap/orders/${d.docEntry}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numAtCard: v }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "Échec");
      savedRef.current = v;
      toast.success(`N° commande enregistré — BL n°${d.docNum}`);
    } catch (e) {
      // Rollback : on repart de la dernière valeur enregistrée côté SAP.
      toast.error(`N° commande non enregistré : ${e instanceof Error ? e.message : ""}`);
      setNum(savedRef.current);
    } finally { setSaving(false); }
  }, [num, d.docEntry, d.docNum]);

  const hasBlock = (alerts ?? []).some((a) => a.severity === "block");

  return (
    <li
      className="flex flex-col gap-1.5 px-4 sm:px-5 py-2.5"
      onContextMenu={(e) => { e.preventDefault(); onOpenBL(d, true); }}
      title="Clic : détail du BL · Clic droit : modifier"
    >
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      {/* Zone cliquable UNIQUE de la ligne → détail du BL. */}
      <div
        className="min-w-0 flex-1 cursor-pointer rounded-lg -mx-1.5 px-1.5 py-0.5 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] hover:bg-secondary/50 active:bg-secondary focus-visible:bg-secondary/50 focus-visible:outline-none"
        role="button"
        tabIndex={0}
        onClick={() => setDetailOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailOpen(true); } }}
        title={`Voir le détail du BL n°${d.docNum}`}
      >
        <p className="flex items-center gap-2 min-w-0 text-body font-semibold text-foreground">
          <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{d.cardFullName ?? d.cardName}</span>
          {d.clientType && SEGMENT_BADGE[d.clientType] && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption2 font-bold uppercase tracking-wide shrink-0 ${SEGMENT_BADGE[d.clientType]}`}>
              {d.clientType}
            </span>
          )}
          {/* GARDE-FOUS — badge d'anomalie (clic : détail sous la ligne). */}
          {(alerts?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowAlerts((v) => !v); }}
              title="Anomalies garde-fous — cliquer pour le détail"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption2 font-bold uppercase tracking-wide shrink-0 ${
                hasBlock
                  ? "bg-destructive/12 text-destructive ring-1 ring-destructive/25"
                  : "bg-warning/12 text-warning ring-1 ring-warning/25"
              }`}
            >
              <ShieldAlert className="h-3 w-3" /> {alerts!.length}
            </button>
          )}
        </p>
        <p className="text-caption text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <span>BL n° {d.docNum}</span>
          {takenTime && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Prise {takenTime}</span>}
          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Livr. {shortDate(d.dueDate)}</span>
          <span>{d.colis.toLocaleString("fr-FR")} colis</span>
          {d.totalHT > 0 && <span>{eur.format(d.totalHT)} HT</span>}
        </p>
      </div>
      {/* N° de commande client (réf.) — saisissable/modifiable, écrit sur le BL. */}
      <label className="inline-flex items-center gap-1.5 shrink-0" title="N° de commande client (référence)">
        <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          value={num}
          onChange={(e) => setNum(e.target.value)}
          onBlur={saveNum}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          disabled={saving || !d.open}
          placeholder="N° cmd"
          aria-label={`N° de commande du BL ${d.docNum}`}
          className="h-8 w-[110px] rounded-md border border-border bg-card px-2 text-caption text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
        />
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
      </label>
      {/* Avancement (pilule 3 crans) + stylo d'édition (BL ouvert uniquement). */}
      <div className="flex items-center gap-1.5 shrink-0">
        <ProgressPill prepared={d.prepared} departed={!!d.departed} />
        {d.open && (
          <button
            type="button"
            onClick={() => onOpenBL(d, true)}
            title="Modifier la commande"
            aria-label={`Modifier le BL ${d.docNum}`}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border text-muted-foreground hover:text-brand-600 hover:border-brand-500/40 active:scale-[0.97] transition-[color,border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-apple)]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
    {/* Détail des anomalies garde-fous (déplié au clic sur le badge). */}
    {showAlerts && (alerts?.length ?? 0) > 0 && (
      <ul className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 space-y-0.5">
        {alerts!.map((a, i) => (
          <li key={i} className={`text-caption2 leading-snug ${
            a.severity === "block" ? "text-destructive font-semibold" : "text-warning"
          }`}>
            • {a.message}
          </li>
        ))}
      </ul>
    )}
    <BLDetailDialog doc={d} open={detailOpen} onOpenChange={setDetailOpen} />
    </li>
  );
}

/** Détail compact d'un BL — plein écran par défaut (mobile), boîte centrée à
 *  partir de `sm`. Une ligne par article (colis · désignation · code · prix ·
 *  total) + tags désignation ; « Modifier » relance la saisie sur l'Écran 2. */
function BLDetailDialog({ doc: d, open, onOpenChange }: { doc: Doc; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [modifBusy, setModifBusy] = useState(false);

  const startModif = useCallback(async () => {
    setModifBusy(true);
    try {
      const r = await fetch(`/api/clients/resolve?code=${encodeURIComponent(d.cardCode)}`);
      const j = await r.json().catch(() => null);
      if (!j?.id) {
        toast.error("Client introuvable en télévente — modification impossible depuis ici.");
        return;
      }
      broadcastActiveClient({
        clientId: j.id,
        clientName: d.cardName,
        stockSharePct: 100,
        client: null,
        modif: { docEntry: d.docEntry, docNum: d.docNum },
      });
      onOpenChange(false);
      router.push("/console/ecran2");
    } catch {
      toast.error("Échec du chargement de la modification.");
    } finally {
      setModifBusy(false);
    }
  }, [d.cardCode, d.cardName, d.docEntry, d.docNum, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Plein écran par défaut (mobile) ; boîte centrée classique à partir de `sm`. */}
      <DialogContent
        className="fixed inset-0 top-0 left-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex flex-col gap-3 overflow-y-auto rounded-none p-4 sm:inset-auto sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[90vh] sm:w-[calc(100%-1.5rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6"
      >
        <DialogHeader className="text-left shrink-0">
          <DialogTitle className="flex items-center justify-between gap-2 pr-6 text-callout">
            <span className="truncate">{d.cardName}</span>
            <span className={`inline-flex items-center gap-1.5 text-caption font-semibold shrink-0 ${d.open ? "text-success" : "text-muted-foreground"}`}>
              <span className={`h-2 w-2 rounded-full shrink-0 ${d.open ? "bg-success" : "bg-muted-foreground/40"}`} />
              {d.open ? "BL modifiable" : "BL clôturé"}
            </span>
          </DialogTitle>
          <DialogDescription className="text-caption text-muted-foreground">
            BL {d.docNum} du {blDateLabel(d.dueDate)}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex-1 divide-y divide-border/60 min-h-0">
          {d.lines.map((l) => (
            <li key={l.itemCode} className="py-2.5">
              <div className="flex items-baseline gap-2 text-body">
                <span className="w-7 shrink-0 text-right font-bold tnum">{l.colis.toLocaleString("fr-FR")}</span>
                {/* Ligne 1 : fruit + marque + calibre (blanc). */}
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="min-w-0 truncate font-semibold text-foreground">{l.itemName}</span>
                  <DesignationStrong l={l} className="min-w-0 truncate" />
                </span>
                <span className="shrink-0 text-muted-foreground hidden sm:inline">{l.itemCode}</span>
                <span className="shrink-0 tnum">{l.price != null ? eur2.format(l.price) : "—"}</span>
                <span className="shrink-0 font-bold tnum">{l.lineTotal != null ? eur2.format(l.lineTotal) : "—"}</span>
              </div>
              {/* Ligne 2 : conditionnement · variété · pays (muted). */}
              <DesignationMuted l={l} className="ml-9 mt-1 text-caption" />
            </li>
          ))}
        </ul>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 pt-3">
          <span className="text-body font-semibold">
            Total HT <b className="tnum">{eur2.format(d.totalHT)}</b>
          </span>
          {d.open && (
            <Button type="button" variant="warning" size="sm" onClick={startModif} disabled={modifBusy}
              title={`Modifier le BL # ${d.docNum} (sur l'Écran 2)`}>
              {modifBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
              Modifier
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
