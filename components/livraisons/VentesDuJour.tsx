"use client";

/**
 * VENTES DU JOUR — état COMPLET des ventes (consultation), groupé par TRANSPORTEUR.
 *
 * Deux volets, adossés à GET /api/livraisons :
 *   • « En préparation »  : les BL de la PROCHAINE livraison (J+1, sauf samedi → lundi) ;
 *   • « En livraison »    : les BL dont la livraison est AUJOURD'HUI (suivi Fait/Départ).
 *
 * La MISE EN PRÉPARATION (lâcher un magasin à l'entrepôt) ne se fait PAS ici :
 * elle vit dans le Détail livraison, onglet « Ventes » (à gauche de « À préparer »).
 * Ici, chaque BL affiche simplement son état : En préparation / En attente.
 *
 * Les BL « avoir / exclu » ne sont pas des ventes → masqués de cet état.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Clock, Loader2, PackageOpen, RefreshCw,
  Search, Store, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { displayPersonName } from "@/lib/userNames";
import { formatDeliveryDate } from "@/lib/livraison";
import { docStatus, isReleased, STATUS_LABEL, type ApiResp, type Doc, type StatusTab } from "@/lib/livraisonView";

/** Date murale Europe/Paris (le poste peut être ailleurs) — « aujourd'hui » métier. */
function parisTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const STATUS_BADGE: Record<StatusTab, string> = {
  A_PREPARER: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  FAIT: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  DEPART: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

/** Même palette de segments que le Détail livraison (SEG_UI de LivraisonDetail). */
const SEGMENT_BADGE: Record<string, string> = {
  CHR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  GMS: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
};

/** Un volet de l'état : la date livrée + les ventes GROUPÉES PAR TRANSPORTEUR
 *  (ordre de l'API : volume de colis décroissant, « Non affecté » en dernier),
 *  hors « avoir / exclu ». */
interface VoletGroup { key: string; name: string; docs: Doc[] }
interface Volet { date: string; groups: VoletGroup[] }

function toVolet(data: ApiResp | null): Volet | null {
  if (!data?.ok) return null;
  return {
    date: data.date,
    groups: data.carriers
      .map((c) => ({
        key: c.code ?? "__none__",
        name: c.name,
        docs: c.docs.filter((d) => !d.excluded).sort((a, b) => a.cardName.localeCompare(b.cardName, "fr")),
      }))
      .filter((g) => g.docs.length > 0),
  };
}

export function VentesDuJour() {
  const [prep, setPrep] = useState<Volet | null>(null);         // prochaine livraison (défaut API)
  const [jour, setJour] = useState<Volet | null>(null);         // livraison d'AUJOURD'HUI
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rPrep, rJour] = await Promise.all([
        fetch("/api/livraisons", { cache: "no-store" }),
        fetch(`/api/livraisons?date=${parisTodayISO()}`, { cache: "no-store" }),
      ]);
      const [jPrep, jJour] = await Promise.all([
        rPrep.json().catch(() => null),
        rJour.json().catch(() => null),
      ]);
      if (jPrep?.ok) setPrep(toVolet(jPrep)); else toast.error(jPrep?.error || "Ventes en préparation indisponibles");
      if (jJour?.ok) setJour(toVolet(jJour));
    } catch {
      toast.error("SAP injoignable — ventes du jour non chargées");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const match = useCallback((d: Doc) =>
    !needle ||
    d.cardName.toLowerCase().includes(needle) ||
    (d.cardFullName ?? "").toLowerCase().includes(needle) ||
    String(d.docNum).includes(needle), [needle]);

  const filterVolet = useCallback((v: Volet | null): VoletGroup[] =>
    (v?.groups ?? [])
      .map((g) => ({ ...g, docs: g.docs.filter(match) }))
      .filter((g) => g.docs.length > 0), [match]);

  const prepGroups = useMemo(() => filterVolet(prep), [prep, filterVolet]);
  const jourGroups = useMemo(() => filterVolet(jour), [jour, filterVolet]);
  const prepDocs = useMemo(() => prepGroups.flatMap((g) => g.docs), [prepGroups]);
  const jourDocs = useMemo(() => jourGroups.flatMap((g) => g.docs), [jourGroups]);
  const pendingCount = prepDocs.filter((d) => !isReleased(d)).length;
  const caPrep = prepDocs.reduce((s, d) => s + d.totalHT, 0);
  const caJour = jourDocs.reduce((s, d) => s + d.totalHT, 0);

  return (
    <div className="space-y-5">
      {/* Bandeau : recherche + rafraîchissement */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par magasin ou n° de BL…"
            aria-label="Filtrer les ventes"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {/* ── Volet 1 : EN PRÉPARATION (prochaine livraison) ── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <PackageOpen className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground leading-tight">
              En préparation{prep?.date ? ` — livraison du ${formatDeliveryDate(prep.date)}` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {loading && !prep ? "Chargement…" : (
                <>
                  {prepDocs.length} vente{prepDocs.length > 1 ? "s" : ""} · {eur.format(caPrep)} HT
                  {pendingCount > 0 && (
                    <> · <b className="text-amber-600 dark:text-amber-400">
                      {pendingCount} en attente de mise en préparation (Détail livraison › Ventes)
                    </b></>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        <VenteGroups groups={prepGroups} loading={loading && !prep} emptyLabel="Aucune vente pour la prochaine livraison." />
      </section>

      {/* ── Volet 2 : EN LIVRAISON (aujourd'hui) ── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
            <Truck className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground leading-tight">
              En livraison{jour?.date ? ` — aujourd'hui, ${formatDeliveryDate(jour.date)}` : " — aujourd'hui"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {loading && !jour
                ? "Chargement…"
                : `${jourDocs.length} vente${jourDocs.length > 1 ? "s" : ""} · ${eur.format(caJour)} HT`}
            </p>
          </div>
        </div>
        <VenteGroups groups={jourGroups} loading={loading && !jour} emptyLabel="Aucune livraison aujourd'hui." />
      </section>
    </div>
  );
}

/** Ventes groupées par TRANSPORTEUR — sous-en-tête par groupe, lignes en consultation. */
function VenteGroups({ groups, loading, emptyLabel }: {
  groups: VoletGroup[];
  loading: boolean;
  emptyLabel: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des ventes…
      </div>
    );
  }
  if (!groups.length) {
    return <p className="px-5 py-4 text-[13px] text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="flex items-center gap-2 px-4 sm:px-5 py-1.5 bg-secondary/20 border-y border-border/60 first:border-t-0">
            <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.name}</span>
            <span className="text-[11px] tnum text-muted-foreground/70">{g.docs.length}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {g.docs.map((d) => <VenteRow key={d.docEntry} d={d} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Ligne de vente — un BL (magasin), consultation seule. */
function VenteRow({ d }: { d: Doc }) {
  const status = docStatus(d);
  const takenTime = d.takenAt ? d.takenAt.slice(11, 16) : null;
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 sm:px-5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 min-w-0 text-[13.5px] font-semibold text-foreground">
          <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{d.cardFullName ?? d.cardName}</span>
          {d.clientType && SEGMENT_BADGE[d.clientType] && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0 ${SEGMENT_BADGE[d.clientType]}`}>
              {d.clientType}
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <span>BL #{d.docNum}</span>
          {takenTime && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Prise {takenTime}</span>}
          <span>{d.colis.toLocaleString("fr-FR")} colis</span>
          {d.totalHT > 0 && <span>{eur.format(d.totalHT)} HT</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {isReleased(d) ? (
          <>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              title={d.misEnPrepBy ? `Mis en préparation par ${displayPersonName(d.misEnPrepBy)}` : "Visible pour l'entrepôt"}
            >
              <CheckCircle2 className="h-3 w-3" /> En préparation
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          </>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-700 dark:text-amber-300"
            title="Pas encore visible entrepôt — mise en préparation depuis le Détail livraison, onglet « Ventes »"
          >
            <Clock className="h-3 w-3" /> En attente
          </span>
        )}
      </div>
    </li>
  );
}
