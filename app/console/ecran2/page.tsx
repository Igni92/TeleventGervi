"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MonitorSmartphone, Loader2, Phone, AlertTriangle, Clock,
  TrendingUp, TrendingDown, Minus, ShoppingCart, User, Users, Mail,
  Calendar, ArrowLeft, Truck, MessageSquareText, Search,
} from "lucide-react";
import { Ecran2Order } from "@/components/console/Ecran2Order";
import { rememberConsoleScreen } from "@/components/console/ConsoleScreenGate";
import { Input } from "@/components/ui/input";
import {
  subscribeActiveClient, readActiveClient, requestActiveClient, clearModif,
  type ActiveClientState, type ActiveClientInfo,
} from "@/lib/consoleSync";
import { formatPhoneDisplay, standardizePhone } from "@/lib/phone";
import { displayNameFromSlp } from "@/lib/salespeople";

type ModifTarget = { docEntry: number; docNum: number; clientId: string | null; clientName: string | null };
/** Compte chargé MANUELLEMENT via la recherche (hors file de télévente). */
type ManualClient = { clientId: string; clientName: string; info: ActiveClientInfo | null };

/**
 * Écran 2 (fenêtre détachée) — optimisé **marge + relation client + incident**.
 * Synchronisé à l'écran 1. Le constructeur de commande prend toute la largeur.
 *
 * Mode MODIFICATION : « Détail livraison » diffuse une cible de modif via
 * consoleSync ; l'écran 2 bascule en saisie sur ce BL **dans la même fenêtre**
 * (aucun nouvel onglet). Le mode est « collant » : une fois en modif, les
 * rediffusions de client actif de la console sont ignorées tant que
 * l'utilisateur n'a pas quitté la modification (bouton « Quitter »).
 */
export default function Ecran2Page() {
  const [state, setState] = useState<ActiveClientState | null>(null);
  const [modif, setModif] = useState<ModifTarget | null>(null);
  // Compte sélectionné MANUELLEMENT via la recherche (pour créer un BL sans
  // passer par la file de télévente). Prioritaire sur le client synchronisé de
  // l'écran 1 ; « collant » jusqu'au clic « Suivre l'écran 1 ».
  const [manual, setManual] = useState<ManualClient | null>(null);
  const [ready, setReady] = useState(false);
  // Réf pour lire l'état « en modif ? » dans le callback de souscription (collant).
  const inModif = useRef(false);
  inModif.current = modif != null;

  // C3 — mémorise « dernier écran Console = Écran 2 » : le lien Console de la
  // sidebar ramènera ici (cf. ConsoleScreenGate sur /console).
  useEffect(() => { rememberConsoleScreen("ecran2"); }, []);

  useEffect(() => {
    const initial = readActiveClient();
    setState(initial);
    if (initial?.modif) {
      setModif({ docEntry: initial.modif.docEntry, docNum: initial.modif.docNum, clientId: initial.clientId, clientName: initial.clientName });
    }
    const unsub = subscribeActiveClient((s) => {
      if (s.modif) {
        // Nouvelle cible de modif → on bascule l'écran (même fenêtre).
        setModif({ docEntry: s.modif.docEntry, docNum: s.modif.docNum, clientId: s.clientId, clientName: s.clientName });
        setState(s);
      } else if (!inModif.current) {
        // Broadcast normal (client actif). En modif, on l'ignore (collant) pour ne
        // pas se faire éjecter par la rediffusion continue de la console.
        setState(s);
      }
    });
    requestActiveClient();
    setReady(true);
    return unsub;
  }, []);

  // Quitte la modification → reprend la synchro normale avec le client actif.
  const exitModif = useCallback(() => {
    clearModif();
    setModif(null);
    const s = readActiveClient();
    if (s) setState({ ...s, modif: null });
  }, []);

  // Recherche → sélection d'un compte : on quitte toute modif en cours et on
  // bascule l'écran 2 sur ce client (mode manuel, hors synchro écran 1).
  const pickManual = useCallback((c: SearchClient) => {
    if (inModif.current) { clearModif(); setModif(null); }
    setManual({ clientId: c.id, clientName: c.nom, info: infoFromSearch(c) });
  }, []);
  // « Suivre l'écran 1 » → on abandonne le compte recherché et on reprend le
  // client synchronisé.
  const clearManual = useCallback(() => setManual(null), []);

  const clientId = modif ? modif.clientId : (manual?.clientId ?? state?.clientId ?? null);
  const clientName = modif ? modif.clientName : (manual?.clientName ?? state?.clientName ?? null);
  const sharePct = state?.stockSharePct ?? 100;
  const info = modif ? null : (manual ? manual.info : (state?.client ?? null));
  const modifier = modif ? { docEntry: modif.docEntry, docNum: modif.docNum } : null;

  return (
    <div className="h-full flex flex-col gap-3 animate-fade-up min-h-0">
      <ClientBanner
        clientId={clientId} clientName={clientName} info={info}
        manual={manual != null} onPick={pickManual} onClearManual={clearManual}
      />

      {/* Constructeur de commande — prend tout l'espace restant */}
      <div className="flex-1 min-h-0">
        {!ready ? (
          <p className="text-[13px] text-muted-foreground inline-flex items-center gap-2 p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Connexion…
          </p>
        ) : clientId && clientName ? (
          <Ecran2Order
            key={modif ? `m${modif.docEntry}` : clientId}
            clientId={clientId} clientName={clientName} stockSharePct={sharePct}
            modifier={modifier} onExitModif={exitModif}
          />
        ) : (
          <div className="h-full flex items-center justify-center panel">
            <p className="hidden md:block text-[13px] text-muted-foreground text-center max-w-xs">
              Sélectionne un client sur l&apos;écran 1 — ou recherche un compte ci-dessus — pour afficher son stock et saisir une commande ici.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Bandeau client riche — toutes les infos contextuelles pour
   conduire l'entretien (téléphones, commercial, interlocuteurs,
   habitudes, incidents, cadence de livraison). Le nom du client
   est cliquable → fiche complète (plus de bouton dédié).
───────────────────────────────────────────────────────────── */

const JOURS_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"] as const;

/** C3 — Retour volontaire à l'Écran 1 dans CETTE fenêtre : on réécrit la
 *  mémoire d'écran AVANT de naviguer, sinon le Gate de /console nous
 *  renverrait immédiatement ici. */
function Ecran1Link() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => { rememberConsoleScreen("ecran1"); router.push("/console"); }}
      title="Revenir à l'Écran 1 (file d'appel) dans cette fenêtre"
      className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 hover:underline shrink-0"
    >
      <ArrowLeft className="h-3 w-3" /> Écran 1
    </button>
  );
}

function ClientBanner({
  clientId, clientName, info, manual, onPick, onClearManual,
}: {
  clientId: string | null; clientName: string | null; info: ActiveClientInfo | null;
  manual: boolean; onPick: (c: SearchClient) => void; onClearManual: () => void;
}) {
  // Fetch unique des dernières livraisons (mini-frise à droite du nom + notes).
  // Appelé AVANT tout return conditionnel (règle des hooks) ; no-op si pas de client.
  const { docs: deliveryDocs } = useClientDeliveries(clientId);

  // Recherche d'un compte (créer un BL hors file de télévente) — toujours
  // accessible, quel que soit l'état de synchronisation.
  const searchRow = (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <ClientSearch onPick={onPick} placeholder="Rechercher un compte (nom ou code)…" />
      </div>
      {manual && (
        <button
          type="button"
          onClick={onClearManual}
          title="Abandonner ce compte et revenir au client synchronisé depuis l'écran 1"
          className="shrink-0 inline-flex items-center gap-1 h-9 px-2.5 rounded-md border border-border bg-card text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-brand-400 transition-colors"
        >
          <MonitorSmartphone className="h-3.5 w-3.5" /> Suivre l&apos;écran 1
        </button>
      )}
    </div>
  );

  if (!clientName) {
    return (
      <div className="shrink-0 space-y-2.5">
        {searchRow}
        <header className="panel px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="kicker mb-0.5 inline-flex items-center gap-1.5">
              <MonitorSmartphone className="h-3 w-3" /> Écran 2 · synchronisé
            </p>
            <Ecran1Link />
          </div>
          <h1 className="text-[19px] font-semibold tracking-tight text-muted-foreground">
            En attente d&apos;un client…
          </h1>
        </header>
      </div>
    );
  }

  const tels = info ? [
    { label: "Standard", value: info.tel1 },
    { label: "Direct 1", value: info.tel2 },
    { label: "Direct 2", value: info.tel3 },
  ].filter((t): t is { label: string; value: string } => !!t.value) : [];

  const commercialName = displayNameFromSlp(info?.commercial);

  const incidents = info?.openIncidents ?? 0;
  const lastDays = info?.lastOrderDays;
  const lastLabel = lastDays === 0 ? "Aujourd'hui"
                  : lastDays === 1 ? "Hier"
                  : lastDays != null ? `il y a ${lastDays} j`
                  : null;

  const TrendIcon = info?.trend30 === "rising"  ? TrendingUp
                  : info?.trend30 === "falling" ? TrendingDown
                  :                                Minus;
  const trendColor = info?.trend30 === "rising"  ? "text-emerald-600 dark:text-emerald-400"
                   : info?.trend30 === "falling" ? "text-rose-500 dark:text-rose-400"
                   :                                "text-muted-foreground";

  return (
    <div className="shrink-0 space-y-2.5">
      {searchRow}
      <header className="panel divide-y divide-border">
      {/* ── Ligne 1 — Identité (nom = lien fiche) + commercial + téléphones ── */}
      <div className="px-4 py-3 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="kicker mb-1 inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <MonitorSmartphone className="h-3 w-3" /> Écran 2 · {manual ? "compte recherché" : "synchronisé"}
            </span>
            <Ecran1Link />
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Le nom EST le lien vers la fiche complète (plus de bouton dédié). */}
            {clientId ? (
              <Link
                href={`/clients/${clientId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Ouvrir la fiche client complète (nouvel onglet)"
                className="text-[22px] font-semibold tracking-tight text-foreground leading-tight truncate hover:text-brand-600 dark:hover:text-brand-400 hover:underline decoration-2 underline-offset-2 transition-colors"
              >
                {clientName}
              </Link>
            ) : (
              <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-tight truncate">
                {clientName}
              </h1>
            )}
            {info?.type && (
              <span className={`text-[10px] font-bold tracking-[0.14em] uppercase px-2 py-0.5 rounded ${
                info.type === "EXPORT" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" :
                info.type === "GMS"    ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" :
                                         "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              }`}>
                {info.type}
              </span>
            )}
            {incidents > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                title={`${incidents} incident(s) BL ouvert(s)`}
              >
                <AlertTriangle className="h-3 w-3" /> {incidents} incident{incidents > 1 ? "s" : ""}
              </span>
            )}
            {/* Mini-frise « livraisons de la semaine » — compacte, à droite du nom. */}
            <div className="ml-auto pl-2"><WeekStripMini docs={deliveryDocs} /></div>
          </div>
          {/* Ligne meta : commercial (nom complet, plus d'acronyme) + e-mail */}
          {(commercialName || info?.email) && (
            <div className="flex items-center gap-3 mt-1.5 text-[11.5px] text-muted-foreground flex-wrap">
              {commercialName && (
                <span className="inline-flex items-center gap-1" title="Commercial en charge">
                  <User className="h-3 w-3" /> {commercialName}
                </span>
              )}
              {info?.email && (
                <a
                  href={`mailto:${info.email}`}
                  className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline truncate max-w-[260px]"
                  title={info.email}
                >
                  <Mail className="h-3 w-3" /> {info.email}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Téléphones — colonne droite, alignés (label fixe 60px, n° tnum) */}
        {tels.length > 0 && (
          <div className="shrink-0 flex flex-col gap-0.5">
            {tels.map((t, i) => (
              <a
                key={t.label}
                href={`tel:${standardizePhone(t.value)}`}
                className={`group inline-flex items-center justify-end gap-2 px-2.5 py-1 rounded-md transition-colors ${
                  i === 0
                    ? "bg-primary/15 hover:bg-primary/25 text-foreground"
                    : "hover:bg-secondary/40 text-foreground/80"
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground w-[60px] text-right shrink-0">
                  {t.label}
                </span>
                <Phone className={`h-3 w-3 shrink-0 ${i === 0 ? "text-primary" : "text-muted-foreground/70"}`} />
                <span className="font-mono tnum text-[13px] font-semibold tracking-tight">{formatPhoneDisplay(t.value)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Ligne 2 — Habitudes en chips (sans jours d'appel) ── */}
      {(lastLabel || info?.medianHour != null || info?.bestDayOfWeek != null || info?.trend30) && (
        <div className="px-4 py-2 flex items-center gap-2 flex-wrap text-[11px]">
          {info?.medianHour != null && (
            <Chip icon={Clock} label="Créneau">
              <span className="font-semibold tnum">{info.medianHour}h</span>
            </Chip>
          )}
          {info?.bestDayOfWeek != null && (
            <Chip icon={Calendar} label="Meilleur jour">
              <span className="font-semibold">{JOURS_FR[info.bestDayOfWeek]}</span>
            </Chip>
          )}
          {lastLabel && (
            <Chip icon={ShoppingCart} label="Dernière cde">
              <span className="font-semibold">{lastLabel}</span>
              {info?.ordersCount != null && info.ordersCount > 0 && (
                <span className="text-muted-foreground"> · {info.ordersCount} cde{info.ordersCount > 1 ? "s" : ""}</span>
              )}
            </Chip>
          )}
          {info?.trend30 && (
            <Chip icon={TrendIcon} label="Tendance 30j">
              <span className={`font-semibold ${trendColor}`}>
                {info.trend30 === "rising" ? "En hausse" : info.trend30 === "falling" ? "En baisse" : "Stable"}
              </span>
            </Chip>
          )}
        </div>
      )}

      {/* ── Ligne 3 — Interlocuteurs (fetch direct, clé = clientId) ── */}
      {clientId && <InterlocuteursStrip clientId={clientId} />}

      {/* ── Ligne 4 — Notes des dernières commandes (vraies remarques) ── */}
      <OrderNotes docs={deliveryDocs} />
      </header>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Recherche de compte — charge n'importe quel client (dans le
   périmètre de l'utilisateur) sur l'écran 2 pour créer un BL sans
   passer par la file de télévente. Dropdown clavier-navigable ;
   requête débouncée sur /api/clients (auth + scope côté serveur).
───────────────────────────────────────────────────────────── */

interface SearchClient {
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
function infoFromSearch(c: SearchClient): ActiveClientInfo {
  return {
    code: c.code, type: c.type, commercial: c.commercial,
    tel1: c.tel1, tel2: c.tel2, tel3: c.tel3, email: c.email,
    sapGroupCode: c.sapGroupCode, sapGroupName: c.sapGroupName,
    notes: c.notes, joursAppel: c.joursAppel,
    openIncidents: null, lastOrderDays: null, ordersCount: null,
    medianHour: null, bestDayOfWeek: null, trend30: null,
  };
}

function ClientSearch({ onPick, placeholder }: {
  onPick: (c: SearchClient) => void; placeholder?: string;
}) {
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
        placeholder={placeholder ?? "Rechercher un compte…"}
        className="pl-9 h-9 text-[13px]"
        aria-label="Rechercher un compte client"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-muted-foreground">Aucun compte trouvé.</p>
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
                      <span className="block text-[12.5px] font-medium text-foreground truncate">{c.nom}</span>
                      <span className="block text-[10.5px] font-mono tnum text-muted-foreground">{c.code}</span>
                    </span>
                    {c.type && (
                      <span className={`shrink-0 text-[9px] font-bold tracking-wider px-1.5 py-px rounded ${
                        c.type === "EXPORT" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" :
                        c.type === "GMS"    ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" :
                                              "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                      }`}>
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

/* Chip uniforme — icône + label uppercase + valeur. Hauteur fixe pour alignement. */
function Chip({
  icon: Icon, label, children,
}: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-border bg-card">
      <Icon className="h-3 w-3 text-muted-foreground/70 shrink-0" />
      <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
        {label}
      </span>
      <span className="text-[11.5px] text-foreground/90">{children}</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   Interlocuteurs — strip horizontal compact (lecture seule).
   Édition complète sur la fiche compte (/clients/[id]).
───────────────────────────────────────────────────────────── */

interface Contact {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

function InterlocuteursStrip({ clientId }: { clientId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContacts([]);
    fetch(`/api/clients/${clientId}/contacts`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { contacts?: Contact[] }) => { if (!cancelled) setContacts(j.contacts ?? []); })
      .catch(() => { if (!cancelled) setContacts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) {
    return (
      <div className="px-4 py-2 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" /> <Loader2 className="h-3 w-3 animate-spin" /> Interlocuteurs…
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="px-4 py-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" />
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">Interlocuteurs</span>
        <span className="italic text-muted-foreground/60">aucun enregistré.</span>
        <Link href={`/clients/${clientId}`} target="_blank" rel="noopener noreferrer"
          className="ml-auto text-[10.5px] text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
          + Ajouter sur la fiche
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-2 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground/80">
        <Users className="h-3 w-3 text-muted-foreground" />
        Interlocuteurs <span className="text-muted-foreground/60 font-normal">({contacts.length})</span>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
        {contacts.map((c, i) => (
          <li key={c.id} className="flex items-baseline gap-1.5 text-[11.5px] min-w-0">
            <span className="h-4 w-4 shrink-0 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 text-[9px] font-bold inline-flex items-center justify-center self-center">
              {i + 1}
            </span>
            <span className="font-medium text-foreground truncate">{c.name}</span>
            {c.role && (
              <span className="text-[10px] text-muted-foreground/80 truncate shrink-0">· {c.role}</span>
            )}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 font-mono tnum text-foreground/80 hover:text-brand-600 ml-auto shrink-0 text-[10.5px]">
                <Phone className="h-2.5 w-2.5" /> {c.phone}
              </a>
            )}
            {c.email && !c.phone && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-foreground/70 hover:text-brand-600 ml-auto shrink-0 text-[10.5px] truncate">
                <Mail className="h-2.5 w-2.5" /> {c.email}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Livraisons de la semaine — MINI-frise compacte (Lun→Dim) posée à
   droite du nom client : carré plein (poids dedans) le jour livré,
   point sinon. + notes des dernières commandes (vraies remarques).
   Source unique : /api/sap/orders (un seul fetch, partagé).
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

/** MINI-frise « semaine » — compacte, à poser à droite du nom client. */
function WeekStripMini({ docs }: { docs: DeliveryDoc[] }) {
  const { days, hasDeliveries } = computeWeek(docs);
  if (!hasDeliveries) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = dayKey(today);
  return (
    <div className="shrink-0 flex items-end gap-[3px]" title="Livraisons de la semaine — poids livré par jour">
      <Truck className="h-4 w-4 text-muted-foreground/60 mb-[7px] mr-1 shrink-0" />
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
                className={`h-[28px] w-[28px] rounded-md flex items-center justify-center text-white shadow-sm bg-gradient-to-br from-brand-400 to-brand-600 ${day.future ? "ring-1 ring-brand-300/70" : ""}`}
              >
                <span className="text-[9.5px] font-bold leading-none tnum">{kgChip(day.del.weightKg)}</span>
              </div>
            ) : (
              <div className="h-[28px] w-[28px] flex items-center justify-center">
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
    <div className="px-4 py-2 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground/80">
        <MessageSquareText className="h-3 w-3 text-muted-foreground" />
        Notes des dernières commandes
      </div>
      <ul className="space-y-1">
        {comments.map((c) => (
          <li key={c.docNum} className="flex items-start gap-2 text-[11.5px] rounded-md border border-border bg-card/60 px-2 py-1">
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
