"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Loader2, FileText, PackageOpen, PackageCheck, ChevronRight,
} from "lucide-react";
import { Ecran2Order } from "@/components/console/Ecran2Order";
import { ConsoleSectionTabs } from "@/components/console/ConsoleSectionTabs";
import { PromoBanner } from "@/components/promos/PromoBanner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  ClientBanner, infoFromSearch,
  type SearchClient, type SearchMode, type DeliveryMode,
} from "@/components/console/ecran2/ClientBanner";
import {
  subscribeActiveClient, readActiveClient, requestActiveClient, clearModif,
  type ActiveClientState, type ActiveClientInfo,
} from "@/lib/consoleSync";

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

  // Mode de livraison / compte SAP du client — remonté ici (au lieu du pied du
  // constructeur) pour poser le sélecteur « compte » à côté du nom dans le bandeau.
  // La valeur est passée au constructeur (utilisée à la création du bon).
  const { modes, modeId, setModeId } = useDeliveryModes(clientId);

  // BL envoyé (création/modif en ARRIÈRE-PLAN) : le client quitte la vue tout
  // de suite — le poste enchaîne pendant que SAP travaille (résultat en toast).
  const displayedIdRef = useRef<string | null>(null);
  displayedIdRef.current = rawClientId;
  const handleSubmitted = useCallback(() => {
    if (inModif.current) { clearModif(); setModif(null); }
    setManual(null);
    setDismissedId(displayedIdRef.current);
  }, []);

  // Bandeau client (nom + méta + recherche « créer / modifier un bon »).
  // REGROUPÉ avec le stock dans un même bloc à gauche : passé au constructeur
  // via `clientHeader` (posé en tête de la colonne stock), ou rendu seul dans
  // l'état « en attente d'un client ».
  const banner = (
    <ClientBanner
      clientId={clientId} clientName={clientName} info={info}
      manual={manual != null || dismissed}
      searchMode={searchMode} onSearchModeChange={setSearchMode}
      onPick={pickClient} onClearManual={clearManual}
      modes={modif ? [] : modes} modeId={modeId}
    />
  );

  return (
    <div className="h-full flex flex-col gap-3 animate-fade-up min-h-0">
      {/* Onglets de section Télévente (Appels / Commande) — l'entrée de nav est
          fusionnée, cette barre bascule entre les deux écrans. */}
      <ConsoleSectionTabs />

      {/* ── Bandeau PROMOTIONS — barre-ticker tout en haut de l'écran ── */}
      <PromoBanner context="commande" />

      {/* Sélecteur de BL (mode « Modifier un bon ») — liste des bons du compte choisi. */}
      <BLPickerDialog client={browseClient} onClose={() => setBrowseClient(null)} onPick={pickModifDoc} />

      {/* Constructeur de commande — prend tout l'espace restant. Le bandeau client
          est regroupé avec le stock (bloc gauche) ; la colonne commande s'aligne
          alors sur toute la hauteur → plus de lignes visibles sans scroller. */}
      <div className="flex-1 min-h-0">
        {!ready ? (
          <p className="text-body text-muted-foreground inline-flex items-center gap-2 p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Connexion…
          </p>
        ) : clientId && clientName ? (
          <Ecran2Order
            key={modif ? `m${modif.docEntry}` : clientId}
            clientId={clientId} clientName={clientName} clientType={info?.type ?? null} stockSharePct={sharePct}
            deliveryModeId={modeId}
            deliveryModes={modif ? [] : modes} onDeliveryModeChange={setModeId}
            clientHeader={banner}
            modifier={modifier} onExitModif={exitModif} onSubmitted={handleSubmitted}
          />
        ) : (
          <div className="h-full flex flex-col gap-3 min-h-0">
            {banner}
            <div className="flex-1 flex items-center justify-center panel">
              <p className="hidden md:block text-body text-muted-foreground text-center max-w-xs">
                Sélectionne un client sur l&apos;écran 1 — ou recherche un compte ci-dessus — pour afficher son stock et saisir une commande ici.
              </p>
            </div>
          </div>
        )}
      </div>
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
          <p className="text-body text-muted-foreground inline-flex items-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des bons…
          </p>
        )}
        {error && <p className="text-body text-destructive py-3">{error}</p>}
        {docs !== null && docs.length === 0 && !error && (
          <p className="text-body text-muted-foreground italic py-3">Aucun bon de livraison pour ce compte.</p>
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
                      closed ? "bg-muted text-muted-foreground" : "bg-success/12 text-success"
                    }`} title={closed ? "Clôturé / annulé" : "Ouvert"}>
                      {closed ? <PackageCheck className="h-3 w-3" /> : <PackageOpen className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
                      <span className="text-body font-semibold text-foreground shrink-0">n° {o.docNum}</span>
                      <span className="text-caption2 text-muted-foreground tnum shrink-0">{fmtDate(o.docDate)}</span>
                      {closed && <span className="text-[10px] text-muted-foreground italic shrink-0">· clôturé</span>}
                      {o.invoiceNum ? (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded bg-info/12 text-info" title="Facture liée">
                          <FileText className="h-2.5 w-2.5" />{o.invoiceNum}
                        </span>
                      ) : null}
                    </span>
                    {o.colis != null && o.colis > 0 && (
                      <span className="shrink-0 text-caption2 text-muted-foreground tnum">{fmtColis(o.colis)} colis</span>
                    )}
                    {o.weightKg != null && o.weightKg > 0 && (
                      <span className="shrink-0 text-caption2 text-muted-foreground tnum">{o.weightKg} kg</span>
                    )}
                    <span className="w-[68px] shrink-0 text-right font-bold tnum text-caption text-foreground">{fmt(o.total)} €</span>
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

/** Modes de livraison / comptes SAP d'un client (sélecteur « compte » du bandeau).
 *  Charge /api/clients/:id/delivery-modes ; pré-sélectionne le mode par défaut. */
function useDeliveryModes(clientId: string | null) {
  const [modes, setModes] = useState<DeliveryMode[]>([]);
  const [modeId, setModeId] = useState("");
  useEffect(() => {
    if (!clientId) { setModes([]); setModeId(""); return; }
    let cancelled = false;
    setModes([]); setModeId("");
    fetch(`/api/clients/${clientId}/delivery-modes`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { modes?: DeliveryMode[] }) => {
        if (cancelled) return;
        const ms = d.modes ?? [];
        setModes(ms);
        const def = ms.find((m) => m.isDefault) ?? ms[0];
        setModeId(def?.id ?? "");
      })
      .catch(() => { if (!cancelled) { setModes([]); setModeId(""); } });
    return () => { cancelled = true; };
  }, [clientId]);
  return { modes, modeId, setModeId };
}
