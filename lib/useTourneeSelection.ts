"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Sélection TRANSPORTEUR + TOURNÉE à la CRÉATION d'un bon (écran 2 & BLDialog).
 *
 * Règle métier : un BL ne part JAMAIS sans tournée. Le hook pré-sélectionne
 * automatiquement le défaut du client — l'utilisateur ne touche au sélecteur
 * que par exception :
 *   1. transporteur par défaut du client (/api/clients/[id]/carriers :
 *      ligne principale SERG_TRCL, sinon le plus utilisé 24 mois) ;
 *   2. tournée par défaut de CE transporteur, dans l'ordre de fiabilité :
 *      TRCL (heure puis nom U_DistBy) → mémoire app (lineId → nom → heure,
 *      même ordre que « Détail livraison ») → tournée unique du transporteur.
 *
 * Le catalogue des tournées vient de SERGTRS (/api/transporteurs?code=X),
 * comme le sélecteur de « Détail livraison » — mêmes libellés, mêmes heures.
 *
 * `validateTournee()` fournit le garde-fou de soumission : transporteur requis,
 * tournée requise dès que le transporteur en a au moins une (avec heure).
 * `tourneePayload()` renvoie les champs à poster sur /api/sap/orders
 * ({ trspCode, trspHeure, tournee }) — le serveur mémorise le choix au succès.
 */

export interface TourneeOption {
  lineId: number;
  nom: string;
  des: string;
  heure: string | null;   // "HH:MM:SS" → ORDR.U_TrspHeur
}

export interface CarrierOption {
  id: string;
  name: string;
  sapValue: string;        // code U_TrspCode (= SERGTRS.Code)
  count?: number;          // nb de cdes (source history) / priorité (trcl)
  tour?: string | null;    // tournée(s) TRCL (U_DistBy), ex. "NORD" ou "NORD / SUD"
  heure?: string | null;   // heure TRCL ("HH:MM:SS")
  /** Tournées de CE transporteur sur la FICHE CLIENT (SERG_TRCL), défaut en tête. */
  tournees?: { nom: string; heure: string | null }[];
}

export interface SavedTournee {
  trspCode: string;
  heure: string | null;
  nom?: string | null;
  des?: string | null;
  lineId?: number | null;
}

/** Payload transporteur/tournée du POST /api/sap/orders. */
export interface TourneePayload {
  trspCode: string;
  trspHeure?: string;
  tournee?: { nom: string | null; des: string | null; lineId: number | null };
}

/* ── Cache module-level des tournées par transporteur (SERGTRS) ─────────────
   Partagé entre écran 2 et BLDialog : un seul fetch par code et par session. */
const tourneesCache = new Map<string, TourneeOption[]>();
const tourneesInflight = new Map<string, Promise<TourneeOption[]>>();

function loadTournees(code: string): Promise<TourneeOption[]> {
  const key = code.trim().toUpperCase();
  const hit = tourneesCache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = tourneesInflight.get(key);
  if (inflight) return inflight;
  const p = fetch(`/api/transporteurs?code=${encodeURIComponent(code)}`)
    .then((r) => r.json())
    .then((j: { ok?: boolean; transporteur?: { tournees?: TourneeOption[] } }) => {
      // On ne met en cache QUE les réponses valides. Un échec transitoire
      // (SAP injoignable → {ok:false}/500) ne doit PAS geler « aucune tournée »
      // pour toute la session : on relance au prochain rendu / changement de
      // transporteur. Le serveur complète de toute façon U_TrspHeur depuis
      // SERG_TRCL si le front n'a pas pu charger la tournée.
      if (!j?.ok) throw new Error("Tournées transporteur indisponibles");
      const list = j.transporteur?.tournees ?? [];
      tourneesCache.set(key, list);
      return list;
    })
    .catch(() => [] as TourneeOption[])   // SAP injoignable → pas de tournées connues (non mis en cache)
    .finally(() => { tourneesInflight.delete(key); });
  tourneesInflight.set(key, p);
  return p;
}

/** Options de tournée pour un transporteur = les tournées de la FICHE CLIENT
 *  (SERG_TRCL : couples U_TrspCode × U_DistBy), et RIEN d'autre. Un client
 *  n'est livré que sur SES tournées : Auchan Cambrai (une seule ligne
 *  ANTOINE × NORD) → une seule option.
 *
 *  Le catalogue SERGTRS ne sert qu'à ENRICHIR chaque tournée de la fiche
 *  (lineId + désignation + heure de repli) quand le nom matche ; une tournée
 *  de la fiche absente du catalogue est proposée quand même (option
 *  « synthétique », lineId négatif — neutralisé au POST). L'heure de la fiche
 *  (ENLEVT) prime sur celle du catalogue.
 *
 *  Repli : client sans tournée sur sa fiche (ou source historique) → catalogue
 *  complet du transporteur (comportement d'avant). */
export function clientTourneeOptions(
  catalog: TourneeOption[],
  carrier: CarrierOption | null,
): TourneeOption[] {
  const fiche = (carrier?.tournees ?? []).filter((t) => t.nom?.trim());
  if (!fiche.length) return catalog;
  return fiche.map((tc, i) => {
    const nom = tc.nom.trim();
    const match = catalog.find((t) => t.nom && t.nom.trim().toUpperCase() === nom.toUpperCase());
    if (match) return tc.heure && match.heure !== tc.heure ? { ...match, heure: tc.heure } : match;
    return { lineId: -(i + 1), nom, des: "", heure: tc.heure };
  });
}

/** Tournée par défaut à pré-sélectionner (lineId en string, "" si aucune).
 *  Ordre de fiabilité : TRCL (nom puis heure — le NOM discrimine mieux :
 *  plusieurs tournées d'un transporteur peuvent partir à la même heure, ex.
 *  IDF / IDF OUEST / IDF SUD toutes à 04H00) → mémoire app (lineId → nom →
 *  heure) → tournée unique. Exporté pur pour testabilité. */
export function pickDefaultTournee(
  list: TourneeOption[],
  carrier: CarrierOption | null,
  saved: SavedTournee | null,
): string {
  const withHeure = list.filter((t) => t.heure);
  // 1) TRCL — vérité métier (comme /api/livraisons : TRCL d'abord, mémoire en repli).
  //    Les noms sont essayés DANS L'ORDRE (la tournée de la ligne 'O' arrive en
  //    tête, cf. lib/clientCarriers) — puis l'heure en repli.
  if (carrier) {
    const noms = (carrier.tour ?? "").split(" / ").map((s) => s.trim().toUpperCase()).filter(Boolean);
    for (const nom of noms) {
      const byNom = withHeure.find((t) => t.nom && t.nom.trim().toUpperCase() === nom);
      if (byNom) return String(byNom.lineId);
    }
    if (carrier.heure) {
      const byH = withHeure.find((t) => t.heure === carrier.heure);
      if (byH) return String(byH.lineId);
    }
  }
  // 2) Mémoire app — même cascade que « Détail livraison » (lineId → nom → heure)
  if (saved && carrier && saved.trspCode.trim().toUpperCase() === carrier.sapValue.trim().toUpperCase()) {
    if (saved.lineId != null && withHeure.some((t) => t.lineId === saved.lineId)) return String(saved.lineId);
    if (saved.nom) {
      const byNom = withHeure.find((t) => t.nom && t.nom.toUpperCase() === saved.nom!.toUpperCase());
      if (byNom) return String(byNom.lineId);
    }
    if (saved.heure) {
      const byH = withHeure.find((t) => t.heure === saved.heure);
      if (byH) return String(byH.lineId);
    }
  }
  // 3) Une seule tournée horodatée → c'est forcément elle
  if (withHeure.length === 1) return String(withHeure[0].lineId);
  return "";
}

export function useTourneeSelection(clientId: string, enabled: boolean = true) {
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [savedTournee, setSavedTournee] = useState<SavedTournee | null>(null);
  // Valeur du sélecteur transporteur = sapValue (code U_TrspCode), "" = aucun.
  const [carrierSap, setCarrierSap] = useState("");
  // Tournées du transporteur sélectionné : undefined = chargement en cours.
  const [tournees, setTournees] = useState<TourneeOption[] | undefined>([]);
  // Valeur du sélecteur tournée = String(lineId), "" = aucune.
  const [tourneeId, setTourneeId] = useState("");

  // ── Transporteurs du client (défaut pré-sélectionné) ──
  // Liste filtrée par client (TRCL / historique), sinon liste complète Carrier.
  useEffect(() => {
    if (!enabled || !clientId) return;
    let cancelled = false;
    setCarriers([]); setSavedTournee(null); setCarrierSap(""); setTourneeId("");
    (async () => {
      let list: CarrierOption[] = [];
      let defaultSap = "";
      let saved: SavedTournee | null = null;
      try {
        const r = await fetch(`/api/clients/${clientId}/carriers`);
        if (r.ok) {
          const d = await r.json();
          type ApiCarrier = {
            id: string; name: string; sapValue?: string | null; count?: number;
            tour?: string | null; heure?: string | null;
            tournees?: { nom: string; heure: string | null }[];
          };
          list = ((d?.carriers ?? []) as ApiCarrier[])
            .filter((c) => typeof c.sapValue === "string" && c.sapValue.trim())
            .map((c) => ({
              id: c.id, name: c.name, sapValue: c.sapValue!.trim(), count: c.count,
              tour: c.tour ?? null, heure: c.heure ?? null, tournees: c.tournees,
            }));
          saved = (d?.savedTournee ?? null) as SavedTournee | null;
          const def = list.find((c) => c.id === d?.defaultId);
          if (def) defaultSap = def.sapValue;
        }
      } catch { /* fallback liste complète ci-dessous */ }
      if (list.length === 0) {
        try {
          const r = await fetch(`/api/carriers`);
          const d = await r.json();
          type Row = { id: string; name: string; sapValue?: string | null; active?: boolean };
          list = ((d?.carriers ?? []) as Row[])
            .filter((c) => c.active !== false && typeof c.sapValue === "string" && c.sapValue.trim())
            .map((c) => ({ id: c.id, name: c.name, sapValue: c.sapValue!.trim() }));
          // Pas de défaut client sur la liste complète — sauf tournée mémorisée.
          if (saved?.trspCode) {
            const mem = list.find((c) => c.sapValue.toUpperCase() === saved!.trspCode.trim().toUpperCase());
            if (mem) defaultSap = mem.sapValue;
          }
        } catch { list = []; }
      }
      if (cancelled) return;
      setCarriers(list);
      setSavedTournee(saved);
      setCarrierSap(defaultSap);
    })();
    return () => { cancelled = true; };
  }, [clientId, enabled]);

  // ── Tournées du transporteur sélectionné + pré-sélection du défaut ──
  const carrierEntry = useMemo(
    () => carriers.find((c) => c.sapValue === carrierSap) ?? null,
    [carriers, carrierSap],
  );
  useEffect(() => {
    if (!enabled) return;
    if (!carrierSap) { setTournees([]); setTourneeId(""); return; }
    let cancelled = false;
    setTournees(undefined); setTourneeId("");
    loadTournees(carrierSap).then((list) => {
      if (cancelled) return;
      // Options = les tournées de la FICHE CLIENT (SERG_TRCL) uniquement : un
      // client avec une seule ligne (ex. ANTOINE × NORD) n'a qu'UNE tournée
      // proposée — pré-sélectionnée d'office. Catalogue complet seulement si
      // la fiche ne porte aucune tournée.
      const options = clientTourneeOptions(list, carrierEntry);
      setTournees(options);
      setTourneeId(pickDefaultTournee(options, carrierEntry, savedTournee));
    });
    return () => { cancelled = true; };
    // carrierEntry/savedTournee suivent carrierSap (même cycle de chargement).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrierSap, enabled]);

  const selectedTournee = useMemo(
    () => (tournees ?? []).find((t) => String(t.lineId) === tourneeId) ?? null,
    [tournees, tourneeId],
  );

  /** Garde-fou de soumission : message d'erreur FR, ou null si OK.
   *  On force une tournée SANS régresser : on ne bloque que quand il y a
   *  vraiment un choix à faire —
   *   • transporteur sélectionné mais tournée (horodatée) pas encore choisie ;
   *   • ou des transporteurs listés mais aucun retenu (l'utilisateur doit choisir).
   *  Si AUCUN transporteur n'est listé (SAP/liste indisponible), on laisse passer :
   *  le serveur résout le défaut SERG_TRCL et complète U_TrspHeur (comportement
   *  historique) — mieux vaut un bon avec le défaut serveur qu'un blocage total. */
  const validateTournee = useCallback((): string | null => {
    if (carrierSap) {
      if (tournees === undefined) return "Tournées du transporteur en cours de chargement — réessaie dans un instant.";
      if (tournees.some((t) => t.heure) && !selectedTournee) {
        return "Choisis la tournée du transporteur avant de créer le bon.";
      }
      return null;
    }
    if (carriers.length > 0) return "Choisis le transporteur et sa tournée avant de créer le bon.";
    return null;   // rien à choisir → défaut résolu côté serveur
  }, [carrierSap, carriers, tournees, selectedTournee]);

  /** Champs transporteur/tournée du POST /api/sap/orders (null si pas de transporteur). */
  const tourneePayload = useCallback((): TourneePayload | null => {
    if (!carrierSap) return null;
    const t = selectedTournee;
    return {
      trspCode: carrierSap,
      ...(t?.heure ? { trspHeure: t.heure } : {}),
      // lineId négatif = option synthétique (tournée de la fiche client absente
      // du catalogue SERGTRS) → pas de lineId mémorisé, le nom/l'heure suffisent.
      ...(t ? { tournee: { nom: t.nom || null, des: t.des || null, lineId: t.lineId >= 0 ? t.lineId : null } } : {}),
    };
  }, [carrierSap, selectedTournee]);

  return {
    carriers,                 // options transporteur (sapValue = valeur du select)
    carrierSap, setCarrierSap,
    tournees,                 // undefined = chargement ; [] = aucune
    tourneeId, setTourneeId,
    selectedTournee,
    validateTournee,
    tourneePayload,
  };
}
