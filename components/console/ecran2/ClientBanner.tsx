"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MonitorSmartphone, Loader2, Phone, AlertTriangle, ArrowLeft, Truck,
  MessageSquareText, Search, Plus, Pencil, History,
} from "lucide-react";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import type { ActiveClientInfo } from "@/lib/consoleSync";
import { formatPhoneDisplay, standardizePhone } from "@/lib/phone";
import { segmentBadgeClass } from "@/lib/segments";

/* ─────────────────────────────────────────────────────────────
   Bandeau client COMPACT (Écran 2 = prise de commande). UNE seule
   rangée : nom (lien fiche), type, incidents, téléphone principal,
   pastille « Historique » (frise semaine + notes en POPOVER) et
   retour Écran 1. La recherche « créer / modifier un bon » reste à
   droite. Les infos commerce (interlocuteurs, habitudes, commercial,
   e-mail) vivent sur l'Écran 1.
───────────────────────────────────────────────────────────── */

/** Mode de la recherche de compte : créer un nouveau bon, ou en modifier un. */
export type SearchMode = "create" | "modify";
/** Mode de livraison / compte SAP du client (sélecteur « compte » du bandeau). */
export interface DeliveryMode { id: string; name: string; sapCardCode: string; isDefault: boolean }

export interface SearchClient {
  id: string; code: string; nom: string; type: string | null;
  commercial: string | null;
  tel1: string | null; tel2: string | null; tel3: string | null;
  email: string | null;
  sapGroupCode: number | null; sapGroupName: string | null;
  notes: string | null; joursAppel: string | null;
}

/** Construit un ActiveClientInfo (bandeau) depuis un résultat de recherche.
 *  Les champs dérivés des insights (dernière cde, créneau, tendance…) ne sont
 *  pas fournis par /api/clients → null (le bandeau les masque proprement). */
export function infoFromSearch(c: SearchClient): ActiveClientInfo {
  return {
    code: c.code, type: c.type, commercial: c.commercial,
    tel1: c.tel1, tel2: c.tel2, tel3: c.tel3, email: c.email,
    sapGroupCode: c.sapGroupCode, sapGroupName: c.sapGroupName,
    notes: c.notes, joursAppel: c.joursAppel,
    openIncidents: null, lastOrderDays: null, ordersCount: null,
    medianHour: null, bestDayOfWeek: null, trend30: null,
  };
}

/** Retour à la Console d'appels (Écran 1) dans CETTE fenêtre. Icône seule.
 *  Les deux écrans restent synchronisés via consoleSync. */
function Ecran1Link() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push("/console")}
      title="Revenir à la Console d'appels (file d'appel)"
      aria-label="Revenir à la Console d'appels"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 hover:bg-secondary/60 transition-colors shrink-0"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
    </button>
  );
}

export function ClientBanner({
  clientId, clientName, info, manual, searchMode, onSearchModeChange, onPick, onClearManual,
  modes, modeId,
}: {
  clientId: string | null; clientName: string | null; info: ActiveClientInfo | null;
  manual: boolean; searchMode: SearchMode; onSearchModeChange: (m: SearchMode) => void;
  onPick: (c: SearchClient) => void; onClearManual: () => void;
  modes: DeliveryMode[]; modeId: string;
}) {
  // Fetch unique des dernières livraisons (frise + notes du popover « Historique »).
  // Appelé AVANT tout return conditionnel (règle des hooks) ; no-op si pas de client.
  const { docs: deliveryDocs } = useClientDeliveries(clientId);

  // Recherche d'un compte — toujours accessible, quel que soit l'état de synchro.
  const searchRow = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchModeToggle mode={searchMode} onChange={onSearchModeChange} />
      <div className="flex-1 min-w-[160px]">
        <ClientSearch mode={searchMode} onPick={onPick} />
      </div>
      {manual && (
        <button
          type="button"
          onClick={onClearManual}
          title="Abandonner ce compte et revenir au client synchronisé depuis l'écran 1"
          className="shrink-0 inline-flex items-center gap-1 h-9 px-2.5 rounded-md border border-border bg-card text-caption2 font-medium text-muted-foreground hover:text-foreground hover:border-brand-400 transition-colors"
        >
          <MonitorSmartphone className="h-3.5 w-3.5" /> Suivre l&apos;écran 1
        </button>
      )}
    </div>
  );

  if (!clientName) {
    return (
      <div className="shrink-0 flex flex-col-reverse lg:flex-row lg:items-center gap-3">
        <header className="panel w-fit max-w-full px-4 py-2">
          <p className="kicker mb-1">Console de commande</p>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-title2 font-semibold tracking-tight text-muted-foreground leading-none">
              En attente d&apos;un client…
            </h1>
            <Ecran1Link />
          </div>
        </header>
        {/* Recherche + création de bon — juste à côté du client */}
        <div className="w-full lg:flex-1 lg:max-w-[560px]">{searchRow}</div>
      </div>
    );
  }

  const tels = info ? [
    { label: "Standard", value: info.tel1 },
    { label: "Direct 1", value: info.tel2 },
    { label: "Direct 2", value: info.tel3 },
  ].filter((t): t is { label: string; value: string } => !!t.value) : [];
  const primaryTel = tels[0] ?? null;

  const incidents = info?.openIncidents ?? 0;
  const activeMode = modes.find((m) => m.id === modeId);
  const altAccount = activeMode && !activeMode.isDefault ? activeMode : null;
  const hasHistory = deliveryDocs.length > 0;

  // ── UNE seule rangée : identité (nom héro + type + incidents + tél + histo)
  //    à gauche, recherche « créer / modifier un bon » à droite. La frise
  //    semaine et les notes de commande sont derrière la pastille « Historique »
  //    (popover) pour ne pas empiler d'infos secondaires pendant la saisie. ──
  return (
    <div className="shrink-0 border-b border-border pb-2 mb-2 flex items-center gap-x-2.5 gap-y-2 flex-wrap">
      {/* Identité — nom cliquable (fiche), type, incidents, téléphone, historique */}
      <div className="flex items-center gap-2.5 min-w-0">
        {clientId ? (
          <Link
            href={`/clients/${clientId}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Ouvrir la fiche client complète (nouvel onglet)"
            className="font-display text-title2 font-semibold tracking-tight text-foreground leading-none truncate max-w-[360px] hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            {clientName}
          </Link>
        ) : (
          <h1 className="font-display text-title2 font-semibold tracking-tight text-foreground leading-none truncate max-w-[360px]">
            {clientName}
          </h1>
        )}
        {info?.type && (
          <span className={`shrink-0 text-[9.5px] font-bold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded ${segmentBadgeClass(info.type)}`}>
            {info.type}
          </span>
        )}
        {/* Compte de livraison alternatif — simple rappel visuel (le CHOIX se fait
            dans le sélecteur transporteur du bon). */}
        {altAccount && (
          <span
            title="Le bon partira sur ce compte — choix dans le sélecteur transporteur du bon"
            className="shrink-0 text-caption2 font-bold tracking-wide uppercase px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-700 dark:text-brand-300"
          >
            Compte {altAccount.name} ({altAccount.sapCardCode})
          </span>
        )}
        {incidents > 0 && (
          <>
            <span className="shrink-0 inline-flex items-center gap-1 text-caption2 font-semibold px-1.5 py-0.5 rounded bg-destructive/12 text-destructive">
              <AlertTriangle className="h-3 w-3" /> {incidents}
            </span>
            <InfoHint label="Incidents BL" size={14}>
              {`${incidents} incident(s) BL ouvert(s)`}
            </InfoHint>
          </>
        )}
        {/* Téléphone PRINCIPAL uniquement — les directs vivent sur la fiche. */}
        {primaryTel && (
          <a
            href={`tel:${standardizePhone(primaryTel.value)}`}
            title={primaryTel.label}
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors font-mono tnum text-caption font-semibold tracking-tight bg-primary/15 hover:bg-primary/25 text-foreground"
          >
            <Phone className="h-3 w-3 shrink-0 text-primary" />
            {formatPhoneDisplay(primaryTel.value)}
          </a>
        )}
        {/* Historique — frise semaine + notes en POPOVER (déplié au clic). */}
        {hasHistory && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Livraisons de la semaine et notes des dernières commandes"
                className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border text-caption2 font-semibold text-muted-foreground hover:text-foreground hover:border-brand-400/60 transition-colors data-[state=open]:border-brand-400/60 data-[state=open]:text-foreground"
              >
                <History className="h-3.5 w-3.5" /> Historique
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[360px] max-w-[92vw] p-3">
              <p className="kicker mb-2 inline-flex items-center gap-1.5">
                <Truck className="h-3 w-3" /> Livraisons de la semaine
              </p>
              <WeekStripMini docs={deliveryDocs} />
              <OrderNotes docs={deliveryDocs} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Ecran1Link />
      </div>
      <span className="flex-1" />
      {/* Recherche + créer / modifier un bon — à droite de la rangée. */}
      <div className="w-full xl:w-[380px] shrink-0">{searchRow}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Recherche de compte — charge n'importe quel client (dans le
   périmètre de l'utilisateur) sur l'écran 2 pour créer un BL sans
   passer par la file de télévente. Dropdown clavier-navigable ;
   requête débouncée sur /api/clients (auth + scope côté serveur).
───────────────────────────────────────────────────────────── */

function ClientSearch({ mode, onPick }: {
  mode: SearchMode; onPick: (c: SearchClient) => void;
}) {
  const placeholder = mode === "modify"
    ? "Compte — modifier un bon (nom ou code)…"
    : "Compte — nouveau bon (nom ou code)…";
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Requête débouncée (≥ 2 caractères). Un compteur de séquence ignore les
  // réponses périmées : une frappe rapide ne doit pas écraser un résultat récent.
  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setResults([]); setLoading(false); setOpen(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/clients?search=${encodeURIComponent(t)}&limit=8`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { clients?: SearchClient[] }) => {
          if (my !== seq.current) return;
          setResults(j.clients ?? []);
          setActiveIdx(0);
          setOpen(true);
        })
        .catch(() => { if (my === seq.current) setResults([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(h);
  }, [term]);

  // Ferme le dropdown au clic hors du composant.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = useCallback((c: SearchClient) => {
    onPick(c);
    setTerm(""); setResults([]); setOpen(false);
  }, [onPick]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); return; }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = results[activeIdx]; if (c) pick(c); }
  };

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder={placeholder}
        className="pl-9 h-9 text-body"
        aria-label="Rechercher un compte client"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-modal overflow-hidden">
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-caption text-muted-foreground">Aucun compte trouvé.</p>
          ) : (
            <ul className="max-h-[280px] overflow-y-auto py-1">
              {results.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => pick(c)}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                      i === activeIdx ? "bg-brand-50 dark:bg-brand-950/40" : "hover:bg-secondary/40"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-caption font-medium text-foreground truncate">{c.nom}</span>
                      <span className="block text-caption2 font-mono tnum text-muted-foreground">{c.code}</span>
                    </span>
                    {c.type && (
                      <span className={`shrink-0 text-[9px] font-bold tracking-wider px-1.5 py-px rounded ${segmentBadgeClass(c.type)}`}>
                        {c.type}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Bascule du mode de recherche — « Créer un bon » (défaut) vs
   « Modifier un bon ». Le mode décide de l'action au clic sur un
   compte trouvé (nouveau BL, ou liste des BL existants à modifier).
───────────────────────────────────────────────────────────── */
function SearchModeToggle({ mode, onChange }: {
  mode: SearchMode; onChange: (m: SearchMode) => void;
}) {
  const base = "inline-flex items-center justify-center gap-1 shrink-0 px-2.5 h-8 rounded-md text-caption2 font-semibold transition-colors";
  const on = "bg-card text-foreground shadow-sm ring-1 ring-border";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5 shrink-0"
      role="tablist"
      aria-label="Mode de la recherche de compte"
    >
      <button
        type="button" role="tab" aria-selected={mode === "create"}
        onClick={() => onChange("create")}
        title="Chercher un compte pour créer un nouveau bon de livraison"
        className={`${base} ${mode === "create" ? on : off}`}
      >
        <Plus className="h-3.5 w-3.5" /> Créer un bon
      </button>
      <button
        type="button" role="tab" aria-selected={mode === "modify"}
        onClick={() => onChange("modify")}
        title="Chercher un compte pour consulter/modifier un de ses bons de livraison"
        className={`${base} ${mode === "modify" ? on : off}`}
      >
        <Pencil className="h-3.5 w-3.5" /> Modifier un bon
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Livraisons de la semaine — MINI-frise compacte (Lun→Dim), rendue
   dans le popover « Historique » : carré plein (poids dedans) le jour
   livré, point sinon. + notes des dernières commandes (vraies
   remarques). Source unique : /api/sap/orders (un seul fetch, partagé).
───────────────────────────────────────────────────────────── */

interface DeliveryDoc {
  docEntry: number; docNum: number; docDate: string; dueDate: string;
  weightKg?: number | null; colis?: number | null; comments?: string | null;
  total?: number;
}

/** Compact « 248 » / « 1,2t » pour tenir dans un petit carré. */
function kgChip(kg: number): string {
  if (kg >= 1000) return (kg / 1000).toFixed(kg >= 10000 ? 0 : 1).replace(".", ",") + "t";
  return String(Math.round(kg));
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Initiales 1 lettre par jour (Lun→Dim) pour la mini-frise. */
const JOURS_INI = ["L", "M", "M", "J", "V", "S", "D"] as const;

/** Fetch unique des dernières commandes d'un client (frise + notes). */
function useClientDeliveries(clientId: string | null) {
  const [docs, setDocs] = useState<DeliveryDoc[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!clientId) { setDocs([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setDocs([]);
    fetch(`/api/sap/orders?clientId=${encodeURIComponent(clientId)}&last=20`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { docs?: DeliveryDoc[] }) => { if (!cancelled) setDocs(j.docs ?? []); })
      .catch(() => { if (!cancelled) setDocs([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);
  return { docs, loading };
}

type DayCell = { dt: Date; key: string; dow: number; del: { weightKg: number; colis: number; count: number } | null; future: boolean };

/** Semaine Lun→Dim d'ancrage (celle de la dernière livraison, sinon en cours). */
function computeWeek(docs: DeliveryDoc[]): { days: DayCell[]; hasDeliveries: boolean } {
  const byDay = new Map<string, { weightKg: number; colis: number; count: number }>();
  for (const d of docs) {
    const key = (d.dueDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const e = byDay.get(key) ?? { weightKg: 0, colis: 0, count: 0 };
    e.weightKg += d.weightKg ?? 0; e.colis += d.colis ?? 0; e.count += 1;
    byDay.set(key, e);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const keys = [...byDay.keys()].sort();
  let anchor = today;
  if (keys.length) { const last = parseKey(keys[keys.length - 1]); if (last > anchor) anchor = last; }
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + (anchor.getDay() === 0 ? -6 : 1 - anchor.getDay()));
  const days: DayCell[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    const key = dayKey(dt);
    days.push({ dt, key, dow: i, del: byDay.get(key) ?? null, future: dt > today });
  }
  return { days, hasDeliveries: byDay.size > 0 };
}

/** MINI-frise « semaine » — compacte, rendue dans le popover « Historique ». */
function WeekStripMini({ docs }: { docs: DeliveryDoc[] }) {
  const { days, hasDeliveries } = computeWeek(docs);
  if (!hasDeliveries) return (
    <p className="text-caption2 text-muted-foreground italic">Aucune livraison récente.</p>
  );
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = dayKey(today);
  return (
    <div className="flex items-end gap-[3px]">
      {days.map((day) => {
        const weekend = day.dow >= 5;
        const isToday = day.key === todayKey;
        return (
          <div key={day.key} className="flex flex-col items-center gap-1">
            <span className={`text-[9px] font-bold leading-none ${
              isToday ? "text-brand-600 dark:text-brand-400"
              : weekend ? "text-muted-foreground/40" : "text-muted-foreground/70"
            }`}>{JOURS_INI[day.dow]}</span>
            {day.del ? (
              <div
                title={`${day.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "2-digit" })} — ${Math.round(day.del.weightKg)} kg · ${day.del.colis} colis (${day.del.count} cde${day.del.count > 1 ? "s" : ""})`}
                className={`h-[30px] w-[30px] rounded-md flex items-center justify-center text-white shadow-sm bg-gradient-to-br from-brand-400 to-brand-600 ${day.future ? "ring-1 ring-brand-300/70" : ""}`}
              >
                <span className="text-[9.5px] font-bold leading-none tnum">{kgChip(day.del.weightKg)}</span>
              </div>
            ) : (
              <div className="h-[30px] w-[30px] flex items-center justify-center">
                <span className={`h-1 w-1 rounded-full ${weekend ? "bg-muted-foreground/15" : "bg-muted-foreground/30"}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Notes des dernières commandes — UNIQUEMENT les vraies remarques tapées.
 *  On exclut le texte auto du champ Comments SAP : signature par défaut
 *  « BL - Televent : MM », mention promo « PROMO : … », simples n° de commande. */
function OrderNotes({ docs }: { docs: DeliveryDoc[] }) {
  const isAutoComment = (t: string) =>
    /^[A-Za-z0-9]{1,5}\s*-\s*Telev[ei]nt\s*:/i.test(t)
    || /^promo\s*:/i.test(t)
    || !/[A-Za-zÀ-ÿ]/.test(t);
  const comments: { date: string; text: string; docNum: number }[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const text = (d.comments ?? "").trim();
    if (!text || seen.has(text) || isAutoComment(text)) continue;
    seen.add(text);
    comments.push({ date: d.dueDate || d.docDate, text, docNum: d.docNum });
    if (comments.length >= 3) break;
  }
  if (comments.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-border/60 space-y-1">
      <div className="flex items-center gap-1.5 text-caption2 uppercase tracking-[0.12em] font-semibold text-foreground/80">
        <MessageSquareText className="h-3 w-3 text-muted-foreground" />
        Notes des dernières commandes
      </div>
      <ul className="space-y-1">
        {comments.map((c) => (
          <li key={c.docNum} className="flex items-start gap-2 text-caption2 rounded-md border border-border bg-card/60 px-2 py-1">
            <span className="shrink-0 text-[9.5px] font-semibold tnum text-muted-foreground mt-0.5">
              {new Date(c.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
            </span>
            <span className="text-foreground/85 leading-snug">{c.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
