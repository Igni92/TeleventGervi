"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MonitorSmartphone, Loader2, Phone, AlertTriangle,
  ArrowLeft, Truck, MessageSquareText, Search,
  Plus, Pencil, FileText, PackageOpen, PackageCheck, ChevronRight,
} from "lucide-react";
import { Ecran2Order } from "@/components/console/Ecran2Order";
import { PromoBanner } from "@/components/promos/PromoBanner";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  subscribeActiveClient, readActiveClient, requestActiveClient, clearModif,
  type ActiveClientState, type ActiveClientInfo,
} from "@/lib/consoleSync";
import { formatPhoneDisplay, standardizePhone } from "@/lib/phone";

type ModifTarget = { docEntry: number; docNum: number; clientId: string | null; clientName: string | null };
/** Compte chargé MANUELLEMENT via la recherche (hors file de télévente). */
type ManualClient = { clientId: string; clientName: string; info: ActiveClientInfo | null };
/** Mode de la recherche de compte : créer un nouveau bon, ou en modifier un existant. */
type SearchMode = "create" | "modify";

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
  // Client ÉCARTÉ de la vue après l'envoi d'un BL (création en arrière-plan) :
  // le poste enchaîne sur le suivant sans attendre SAP. La rediffusion continue
  // de l'écran 1 ne le ramène pas ; un AUTRE client, la recherche ou « Suivre
  // l'écran 1 » lèvent l'écart.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const dismissedRef = useRef<string | null>(null);
  dismissedRef.current = dismissedId;
  const [ready, setReady] = useState(false);
  // Réf pour lire l'état « en modif ? » dans le callback de souscription (collant).
  const inModif = useRef(false);
  inModif.current = modif != null;

  // Mode de la recherche de compte : « create » = créer un nouveau bon (défaut),
  // « modify » = ouvrir la liste des BL du compte pour en consulter/modifier un.
  const [searchMode, setSearchMode] = useState<SearchMode>("create");
  // Compte dont on parcourt les BL existants (dialog de sélection, mode « modify »).
  const [browseClient, setBrowseClient] = useState<{ id: string; nom: string } | null>(null);

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
        setDismissedId(null);
      } else if (!inModif.current) {
        // Broadcast normal (client actif). En modif, on l'ignore (collant) pour ne
        // pas se faire éjecter par la rediffusion continue de la console.
        setState(s);
        // Un AUTRE client arrive → l'écart post-envoi est levé (le précédent
        // pourra revenir plus tard) ; la rediffusion du MÊME client ne le ramène pas.
        if (s.clientId && dismissedRef.current && s.clientId !== dismissedRef.current) setDismissedId(null);
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
    setDismissedId(null);
    setManual({ clientId: c.id, clientName: c.nom, info: infoFromSearch(c) });
  }, []);
  // « Suivre l'écran 1 » → on abandonne le compte recherché (et tout écart
  // post-envoi) et on reprend le client synchronisé.
  const clearManual = useCallback(() => { setManual(null); setDismissedId(null); }, []);

  // Recherche → clic sur un compte : selon le mode, on CRÉE un nouveau bon
  // (« create » → pickManual) ou on ouvre la liste de ses BL à modifier
  // (« modify » → dialog de sélection).
  const pickClient = useCallback((c: SearchClient) => {
    if (searchMode === "modify") { setBrowseClient({ id: c.id, nom: c.nom }); return; }
    pickManual(c);
  }, [searchMode, pickManual]);

  // Sélection d'un BL existant → bascule l'écran 2 en MODIFICATION sur ce bon
  // (même fenêtre), exactement comme la modif diffusée par « Détail livraison ».
  const pickModifDoc = useCallback((doc: { docEntry: number; docNum: number }) => {
    const c = browseClient;
    if (!c) return;
    if (inModif.current) clearModif();
    setManual(null);
    setDismissedId(null);
    setModif({ docEntry: doc.docEntry, docNum: doc.docNum, clientId: c.id, clientName: c.nom });
    setBrowseClient(null);
  }, [browseClient]);

  const rawClientId = modif ? modif.clientId : (manual?.clientId ?? state?.clientId ?? null);
  // Client écarté après l'envoi d'un BL → la vue est LIBRE (client suivant).
  const dismissed = !modif && rawClientId != null && rawClientId === dismissedId;
  const clientId = dismissed ? null : rawClientId;
  const clientName = dismissed ? null : (modif ? modif.clientName : (manual?.clientName ?? state?.clientName ?? null));
  const sharePct = state?.stockSharePct ?? 100;
  const info = modif || dismissed ? null : (manual ? manual.info : (state?.client ?? null));
  const modifier = modif ? { docEntry: modif.docEntry, docNum: modif.docNum } : null;

  // BL envoyé (création/modif en ARRIÈRE-PLAN) : le client quitte la vue tout
  // de suite — le poste enchaîne pendant que SAP travaille (résultat en toast).
  const displayedIdRef = useRef<string | null>(null);
  displayedIdRef.current = rawClientId;
  const handleSubmitted = useCallback(() => {
    if (inModif.current) { clearModif(); setModif(null); }
    setManual(null);
    setDismissedId(displayedIdRef.current);
  }, []);

  return (
    <div className="h-full flex flex-col gap-3 animate-fade-up min-h-0">
      {/* ── Bandeau PROMOTIONS — barre tout en haut de l'écran ── */}
      <PromoBanner context="commande" />

      <ClientBanner
        clientId={clientId} clientName={clientName} info={info}
        manual={manual != null || dismissed}
        searchMode={searchMode} onSearchModeChange={setSearchMode}
        onPick={pickClient} onClearManual={clearManual}
      />

      {/* Sélecteur de BL (mode « Modifier un bon ») — liste des bons du compte choisi. */}
      <BLPickerDialog client={browseClient} onClose={() => setBrowseClient(null)} onPick={pickModifDoc} />

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
            modifier={modifier} onExitModif={exitModif} onSubmitted={handleSubmitted}
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
   Bandeau client COMPACT — Écran 2 = prise de commande. Une seule
   ligne : nom (lien fiche), type, incidents, téléphones, mini-frise
   livraisons. Les infos COMMERCE (interlocuteurs, habitudes,
   commercial, e-mail) vivent sur l'Écran 1.
───────────────────────────────────────────────────────────── */

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

function ClientBanner({
  clientId, clientName, info, manual, searchMode, onSearchModeChange, onPick, onClearManual,
}: {
  clientId: string | null; clientName: string | null; info: ActiveClientInfo | null;
  manual: boolean; searchMode: SearchMode; onSearchModeChange: (m: SearchMode) => void;
  onPick: (c: SearchClient) => void; onClearManual: () => void;
}) {
  // Fetch unique des dernières livraisons (mini-frise à droite du nom + notes).
  // Appelé AVANT tout return conditionnel (règle des hooks) ; no-op si pas de client.
  const { docs: deliveryDocs } = useClientDeliveries(clientId);

  // Recherche d'un compte — toujours accessible, quel que soit l'état de synchro.
  // Un sélecteur de mode (au-dessus) décide de l'action au clic sur un compte :
  //   • « Créer un bon »   → charge le compte pour saisir un nouveau BL ;
  //   • « Modifier un bon » → ouvre la liste de ses BL pour en consulter/modifier un.
  const searchRow = (
    <div className="space-y-1.5">
      <SearchModeToggle mode={searchMode} onChange={onSearchModeChange} />
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <ClientSearch mode={searchMode} onPick={onPick} />
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
    </div>
  );

  if (!clientName) {
    return (
      <div className="shrink-0 flex flex-col-reverse lg:flex-row lg:items-center lg:justify-between gap-2">
        <header className="panel w-fit max-w-full px-4 py-2.5">
          <p className="kicker mb-1.5">Console de commande</p>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[22px] sm:text-[26px] font-semibold tracking-tight text-muted-foreground leading-none">
              En attente d&apos;un client…
            </h1>
            <Ecran1Link />
          </div>
        </header>
        {/* Recherche d'un compte — en haut à DROITE */}
        <div className="w-full lg:w-[320px] shrink-0">{searchRow}</div>
      </div>
    );
  }

  const tels = info ? [
    { label: "Standard", value: info.tel1 },
    { label: "Direct 1", value: info.tel2 },
    { label: "Direct 2", value: info.tel3 },
  ].filter((t): t is { label: string; value: string } => !!t.value) : [];

  const incidents = info?.openIncidents ?? 0;

  // ── Bandeau client — Écran 2 = prise de commande. Le nom du client est le
  //    HÉRO du bandeau (même traitement « display » que le « Bonjour » de
  //    l'accueil : kicker + grand titre), pour l'identifier au premier coup
  //    d'œil pendant la saisie. Les infos commerce (interlocuteurs, habitudes,
  //    commercial, e-mail…) vivent sur l'Écran 1 ; ici on garde une méta légère
  //    (type, incidents, téléphones, mini-frise). Largeur au contenu (w-fit).
  return (
    <div className="shrink-0 flex flex-col-reverse lg:flex-row lg:items-start lg:justify-between gap-2">
      <header className="panel w-fit max-w-full px-4 py-2.5">
        <p className="kicker mb-1.5">Compte · prise de commande</p>
        {/* Nom client — HÉRO du bandeau (grand titre display, comme l'accueil). */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Le nom EST le lien vers la fiche complète. */}
          {clientId ? (
            <Link
              href={`/clients/${clientId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir la fiche client complète (nouvel onglet)"
              className="font-display text-[24px] sm:text-[27px] font-semibold tracking-tight text-foreground leading-none truncate max-w-[440px] hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              {clientName}
            </Link>
          ) : (
            <h1 className="font-display text-[24px] sm:text-[27px] font-semibold tracking-tight text-foreground leading-none truncate max-w-[440px]">
              {clientName}
            </h1>
          )}
          {info?.type && (
            <span className={`shrink-0 text-[9.5px] font-bold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded ${
              info.type === "EXPORT" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" :
              info.type === "GMS"    ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" :
                                       "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            }`}>
              {info.type}
            </span>
          )}
        </div>
        {/* Méta légère — incidents, téléphones, mini-frise, retour Écran 1. */}
        <div className="mt-2 flex items-center gap-2.5 flex-wrap min-w-0">
          {incidents > 0 && (
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
              title={`${incidents} incident(s) BL ouvert(s)`}
            >
              <AlertTriangle className="h-3 w-3" /> {incidents}
            </span>
          )}
          {/* Téléphones — inline, compacts (le 1er mis en avant) */}
          {tels.slice(0, 2).map((t, i) => (
            <a
              key={t.label}
              href={`tel:${standardizePhone(t.value)}`}
              title={t.label}
              className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors font-mono tnum text-[12px] font-semibold tracking-tight ${
                i === 0 ? "bg-primary/15 hover:bg-primary/25 text-foreground" : "hover:bg-secondary/40 text-foreground/75"
              }`}
            >
              <Phone className={`h-3 w-3 shrink-0 ${i === 0 ? "text-primary" : "text-muted-foreground/70"}`} />
              {formatPhoneDisplay(t.value)}
            </a>
          ))}
          {/* Mini-frise « livraisons de la semaine » */}
          <WeekStripMini docs={deliveryDocs} />
          <Ecran1Link />
        </div>
        {/* Notes des dernières commandes (vraies remarques) — utile à la saisie */}
        <OrderNotes docs={deliveryDocs} compact />
      </header>
      {/* Recherche d'un compte — en haut à DROITE */}
      <div className="w-full lg:w-[320px] shrink-0">{searchRow}</div>
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

/* ─────────────────────────────────────────────────────────────
   Bascule du mode de recherche — « Créer un bon » (défaut) vs
   « Modifier un bon ». Le mode décide de l'action au clic sur un
   compte trouvé (nouveau BL, ou liste des BL existants à modifier).
───────────────────────────────────────────────────────────── */
function SearchModeToggle({ mode, onChange }: {
  mode: SearchMode; onChange: (m: SearchMode) => void;
}) {
  const base = "inline-flex items-center justify-center gap-1 flex-1 h-7 rounded-md text-[11px] font-semibold transition-colors";
  const on = "bg-card text-foreground shadow-sm ring-1 ring-border";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5"
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
   Sélecteur de BL — mode « Modifier un bon » : liste les derniers
   bons de livraison du compte choisi. Cliquer un bon le charge sur
   l'Écran 2 en MODIFICATION (même fenêtre), comme la modif diffusée
   par « Détail livraison ». Source : /api/sap/orders.
───────────────────────────────────────────────────────────── */
interface PickDoc {
  docEntry: number; docNum: number; docDate: string; dueDate: string;
  total: number; status?: string; weightKg?: number | null; colis?: number | null;
  invoiceNum?: number | null;
}

function BLPickerDialog({ client, onClose, onPick }: {
  client: { id: string; nom: string } | null;
  onClose: () => void;
  onPick: (doc: { docEntry: number; docNum: number }) => void;
}) {
  const [docs, setDocs] = useState<PickDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) { setDocs(null); setError(null); return; }
    let cancelled = false;
    setDocs(null); setError(null);
    fetch(`/api/sap/orders?clientId=${encodeURIComponent(client.id)}&last=15`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { docs?: PickDoc[] }) => { if (!cancelled) setDocs(j.docs ?? []); })
      .catch(() => { if (!cancelled) setError("Chargement des bons impossible."); });
    return () => { cancelled = true; };
  }, [client?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const fmtColis = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

  return (
    <Dialog open={!!client} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Modifier un bon{client ? ` — ${client.nom}` : ""}
          </DialogTitle>
          <DialogDescription>
            Choisis le bon de livraison à consulter et modifier — il s&apos;ouvre sur cet écran en mode modification.
          </DialogDescription>
        </DialogHeader>

        {docs === null && !error && (
          <p className="text-[13px] text-muted-foreground inline-flex items-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des bons…
          </p>
        )}
        {error && <p className="text-[13px] text-rose-600 dark:text-rose-400 py-3">⚠️ {error}</p>}
        {docs !== null && docs.length === 0 && !error && (
          <p className="text-[13px] text-muted-foreground italic py-3">Aucun bon de livraison pour ce compte.</p>
        )}

        {docs && docs.length > 0 && (
          <ul className="divide-y divide-border/60">
            {docs.map((o) => {
              const closed = o.status === "bost_Close";
              return (
                <li key={o.docEntry}>
                  <button
                    type="button"
                    onClick={() => onPick({ docEntry: o.docEntry, docNum: o.docNum })}
                    title={`Ouvrir le BL n° ${o.docNum} en modification`}
                    className="w-full flex items-center gap-2 py-2 -mx-1 px-1 rounded-md hover:bg-secondary/50 transition-colors text-left group"
                  >
                    <span className={`shrink-0 inline-flex items-center justify-center h-5 w-9 rounded text-[10px] font-semibold tnum ${
                      closed ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    }`} title={closed ? "Clôturé / annulé" : "Ouvert"}>
                      {closed ? <PackageCheck className="h-3 w-3" /> : <PackageOpen className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
                      <span className="text-[13px] font-semibold text-foreground shrink-0"># {o.docNum}</span>
                      <span className="text-[11px] text-muted-foreground tnum shrink-0">{fmtDate(o.docDate)}</span>
                      {closed && <span className="text-[10px] text-muted-foreground italic shrink-0">· clôturé</span>}
                      {o.invoiceNum ? (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" title="Facture liée">
                          <FileText className="h-2.5 w-2.5" />{o.invoiceNum}
                        </span>
                      ) : null}
                    </span>
                    {o.colis != null && o.colis > 0 && (
                      <span className="shrink-0 text-[11px] text-muted-foreground tnum">{fmtColis(o.colis)} colis</span>
                    )}
                    {o.weightKg != null && o.weightKg > 0 && (
                      <span className="shrink-0 text-[11px] text-muted-foreground tnum">{o.weightKg} kg</span>
                    )}
                    <span className="w-[68px] shrink-0 text-right font-bold tnum text-[12px] text-foreground">{fmt(o.total)} €</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
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
function OrderNotes({ docs, compact = false }: { docs: DeliveryDoc[]; compact?: boolean }) {
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
    if (comments.length >= (compact ? 2 : 3)) break;
  }
  if (comments.length === 0) return null;
  return (
    <div className={compact ? "pt-1 pb-0.5 space-y-0.5" : "px-4 py-2 space-y-1"}>
      {!compact && (
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground/80">
          <MessageSquareText className="h-3 w-3 text-muted-foreground" />
          Notes des dernières commandes
        </div>
      )}
      <ul className={compact ? "space-y-0.5" : "space-y-1"}>
        {comments.map((c) => (
          <li key={c.docNum} className="flex items-start gap-2 text-[11px] rounded-md border border-border bg-card/60 px-2 py-0.5">
            {compact && <MessageSquareText className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />}
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
