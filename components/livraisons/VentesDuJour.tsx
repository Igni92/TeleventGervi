"use client";

/**
 * VENTES DU JOUR — les ventes SAISIES aujourd'hui (jour où la commande est
 * RENTRÉE dans le système, = DocDate), quelle que soit leur date de livraison.
 * Consultation seule, groupée par TRANSPORTEUR.
 *
 * Pour chaque BL, on montre l'avancement de la préparation par deux COCHES :
 *   • « Préparé » (verte cochée quand la commande est faite) ;
 *   • « Départ »  (bleue cochée quand la commande est partie en livraison).
 * + la date de livraison prévue (souvent J+1, mais variable).
 *
 * Les BL « avoir / exclu » ne sont pas des ventes → masqués de cet état.
 * (La mise en préparation / le suivi de picking vivent dans le Détail livraison.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Clock, Hash, Loader2, RefreshCw, Search, ShieldAlert, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { formatDeliveryDate } from "@/lib/livraison";
import type { ApiResp, Doc } from "@/lib/livraisonView";
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

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** Même palette de segments que le Détail livraison (SEG_UI de LivraisonDetail). */
const SEGMENT_BADGE: Record<string, string> = {
  CHR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  GMS: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
};

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
      {/* Bandeau : synthèse + recherche + rafraîchissement */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par magasin ou n° de BL…"
            aria-label="Filtrer les ventes"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {/* Synthèse du jour */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Ventes saisies" value={docs.length.toString()} />
        <Stat label="CA HT" value={eur.format(ca)} />
        <Stat label="Préparées" value={`${prepared}/${docs.length}`} tone="emerald" />
        <Stat label="Parties" value={`${departed}/${docs.length}`} tone="sky" />
        {/* Garde-fous (Paramètres) : ventes du jour présentant ≥ 1 anomalie. */}
        <Stat label="Alertes garde-fous" value={alerted.toString()} tone={alerted > 0 ? "amber" : undefined} />
      </div>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400">
            <Store className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground leading-tight">
              Ventes saisies aujourd&apos;hui{data?.date ? ` — ${formatDeliveryDate(data.date)}` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {loading && !data
                ? "Chargement…"
                : `${docs.length} vente${docs.length > 1 ? "s" : ""} · ${eur.format(ca)} HT · groupées par transporteur`}
            </p>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des ventes…
          </div>
        ) : groups.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted-foreground text-center">
            Aucune vente saisie aujourd&apos;hui{needle ? " pour cette recherche" : ""}.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 px-4 sm:px-5 py-1.5 bg-secondary/20 border-y border-border/60">
                <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground truncate">{g.name}</span>
                <span className="text-[11px] tnum text-muted-foreground/70">{g.docs.length}</span>
              </div>
              <ul className="divide-y divide-border/60">
                {g.docs.map((d) => <VenteRow key={d.docEntry} d={d} alerts={alerts[d.docEntry]} />)}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "sky" | "amber" }) {
  const color = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "sky" ? "text-sky-600 dark:text-sky-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className={`text-[18px] font-bold tnum leading-tight ${color}`}>{value}</p>
    </div>
  );
}

/** Coche d'avancement — verte/bleue cochée quand l'étape est atteinte, grise sinon. */
function Coche({ done, label, tone }: { done: boolean; label: string; tone: "emerald" | "sky" }) {
  const on = tone === "emerald"
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
    : "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 h-7 text-[11px] font-semibold ${
        done ? on : "border-border text-muted-foreground/60"
      }`}
      title={done ? `${label} ✓` : `${label} — pas encore`}
    >
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded ${
        done ? (tone === "emerald" ? "bg-emerald-500 text-white" : "bg-sky-500 text-white") : "border border-border"
      }`}>
        {done && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label}
    </span>
  );
}

/** Ligne de vente — un BL (magasin), consultation ; coches préparé + départ.
 *  `alerts` = anomalies garde-fous détectées a posteriori (badge + détail dépliable). */
function VenteRow({ d, alerts }: { d: Doc; alerts?: SafeguardViolation[] }) {
  const takenTime = d.takenAt ? d.takenAt.slice(11, 16) : null;
  const [showAlerts, setShowAlerts] = useState(false);
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
      toast.success(`N° commande enregistré — BL #${d.docNum}`);
    } catch (e) {
      toast.error(`N° commande non enregistré : ${e instanceof Error ? e.message : ""}`);
      setNum(savedRef.current);
    } finally { setSaving(false); }
  }, [num, d.docEntry, d.docNum]);

  const hasBlock = (alerts ?? []).some((a) => a.severity === "block");

  return (
    <li className="flex flex-col gap-1.5 px-4 sm:px-5 py-2.5">
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 min-w-0 text-[13.5px] font-semibold text-foreground">
          <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{d.cardFullName ?? d.cardName}</span>
          {d.clientType && SEGMENT_BADGE[d.clientType] && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0 ${SEGMENT_BADGE[d.clientType]}`}>
              {d.clientType}
            </span>
          )}
          {/* GARDE-FOUS — badge d'anomalie (clic : détail sous la ligne). */}
          {(alerts?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowAlerts((v) => !v)}
              title="Anomalies garde-fous — cliquer pour le détail"
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0 ${
                hasBlock
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              }`}
            >
              <ShieldAlert className="h-3 w-3" /> {alerts!.length}
            </button>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <span>BL # {d.docNum}</span>
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
          className="h-8 w-[110px] rounded-md border border-border bg-card px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
        />
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
      </label>
      {/* Avancement : coches Préparé (fait) puis Départ (parti). */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Coche done={d.prepared || !!d.departed} label="Préparé" tone="emerald" />
        <Coche done={!!d.departed} label="Départ" tone="sky" />
      </div>
    </div>
    {/* Détail des anomalies garde-fous (déplié au clic sur le badge). */}
    {showAlerts && (alerts?.length ?? 0) > 0 && (
      <ul className="rounded-lg border border-amber-300/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/20 px-3 py-2 space-y-0.5">
        {alerts!.map((a, i) => (
          <li key={i} className={`text-[11.5px] leading-snug ${
            a.severity === "block"
              ? "text-rose-700 dark:text-rose-300 font-semibold"
              : "text-amber-800/90 dark:text-amber-200/90"
          }`}>
            • {a.message}
          </li>
        ))}
      </ul>
    )}
    </li>
  );
}
