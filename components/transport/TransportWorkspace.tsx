"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Truck, RefreshCw, Trash2, AlertTriangle, Thermometer, PackageCheck, ArrowUp, ArrowDown, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateStepper, todayISO } from "@/components/ui/date-stepper";
import { NumberInput } from "@/components/ui/number-input";
import {
  CANAUX, CANAL_LABEL, STATUT_LABEL, NEXT_CLICK_STATUT,
} from "@/lib/transport";

type Chauffeur = { id: string; nom: string; type: string; societe?: string | null; email?: string | null; actif?: boolean };
type Expedition = {
  id: string; date: string; numCommande: string | null; refSuivi: string;
  clientNom: string; clientAdresse: string | null; creneau: string | null; canal: string;
  chauffeurId: string | null; tourneeId: string | null; ordre: number; statut: string;
  tempChargement: number | null; immatriculation: string | null; observations: string | null;
  colis: number | null; poidsKg: number | null;
  chauffeur?: Chauffeur | null;
};

/** Couleur pleine + libellé par statut (§Annexe A : cartouche colorée, texte blanc). */
const STATUT_UI: Record<string, { bg: string; ring: string }> = {
  A_PREPARER: { bg: "bg-rose-600 hover:bg-rose-500", ring: "ring-rose-300/40" },
  PREPAREE: { bg: "bg-orange-500 hover:bg-orange-400", ring: "ring-orange-300/40" },
  EXPEDIE: { bg: "bg-emerald-600 hover:bg-emerald-500", ring: "ring-emerald-300/40" },
  LIVREE: { bg: "bg-sky-700 hover:bg-sky-600", ring: "ring-sky-300/40" },
  INCIDENT: { bg: "bg-zinc-600 hover:bg-zinc-500", ring: "ring-zinc-300/40" },
};

export function TransportWorkspace() {
  const [date, setDate] = useState(todayISO());
  const [exps, setExps] = useState<Expedition[]>([]);
  const [chauffeurs, setChauffeurs] = useState<Chauffeur[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [newCanal, setNewCanal] = useState("GMS");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, c] = await Promise.all([
        fetch(`/api/transport/expeditions?date=${date}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/transport/chauffeurs`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setExps(e?.expeditions ?? []);
      setChauffeurs(c?.chauffeurs ?? []);
    } catch { setExps([]); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  /** Applique une modif serveur puis remplace l'expédition en place (sans recharger). */
  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    const prev = exps;
    try {
      const r = await fetch(`/api/transport/expeditions/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec");
      setExps((cur) => cur.map((x) => (x.id === id ? j.expedition : x)));
    } catch (e) {
      setExps(prev);
      toast.error(`Échec : ${e instanceof Error ? e.message : ""}`);
    }
  }, [exps]);

  // Clic sur la cartouche = étape suivante du cycle nominal (boucle).
  const advance = (x: Expedition) => {
    const next = NEXT_CLICK_STATUT[x.statut];
    if (!next) return; // LIVREE / INCIDENT : hors boucle (via menu)
    patch(x.id, { statut: next });
  };

  const prefill = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/transport/expeditions/prefill?date=${date}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec");
      toast.success(j.created > 0 ? `${j.created} expédition(s) pré-remplie(s) depuis les BL du jour` : "Aucun nouveau BL à pré-remplir");
      await load();
    } catch (e) { toast.error(`Pré-remplissage : ${e instanceof Error ? e.message : ""}`); }
    finally { setBusy(false); }
  };

  const addManual = async () => {
    const clientNom = newClient.trim();
    if (!clientNom) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/transport/expeditions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, clientNom, canal: newCanal }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec");
      setNewClient(""); setAdding(false);
      await load();
    } catch (e) { toast.error(`Ajout : ${e instanceof Error ? e.message : ""}`); }
    finally { setBusy(false); }
  };

  const removeExp = async (id: string) => {
    setExps((cur) => cur.filter((x) => x.id !== id));
    try { await fetch(`/api/transport/expeditions/${id}`, { method: "DELETE" }); }
    catch { load(); }
  };

  // ── Chauffeurs & feuilles de route ──
  const [showChauff, setShowChauff] = useState(false);
  const [newChaufNom, setNewChaufNom] = useState("");
  const [newChaufType, setNewChaufType] = useState("EXTERIEUR");
  const [newChaufSociete, setNewChaufSociete] = useState("");
  const [newChaufEmail, setNewChaufEmail] = useState("");

  const addChauffeur = async () => {
    const nom = newChaufNom.trim();
    if (!nom) return;
    try {
      const r = await fetch("/api/transport/chauffeurs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom, type: newChaufType, societe: newChaufSociete.trim() || undefined, email: newChaufEmail.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec");
      setNewChaufNom(""); setNewChaufSociete(""); setNewChaufEmail("");
      setChauffeurs((cur) => [...cur, j.chauffeur].sort((a, b) => a.nom.localeCompare(b.nom)));
    } catch (e) { toast.error(`Chauffeur : ${e instanceof Error ? e.message : ""}`); }
  };

  /** Récupère (ou crée) le lien tokenisé de la feuille de route d'un chauffeur ce jour. */
  const tourneeLink = useCallback(async (chauffeurId: string): Promise<string | null> => {
    try {
      const r = await fetch("/api/transport/tournees", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, chauffeurId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec");
      return j.tournee.token as string;
    } catch (e) { toast.error(`Feuille : ${e instanceof Error ? e.message : ""}`); return null; }
  }, [date]);

  const openFeuille = async (chauffeurId: string) => {
    const token = await tourneeLink(chauffeurId);
    if (token) window.open(`/feuille-route/${token}`, "_blank", "noopener");
  };
  const emailFeuille = async (chauffeurId: string, annonce: boolean) => {
    const token = await tourneeLink(chauffeurId);
    if (!token) return;
    try {
      const r = await fetch(`/api/transport/tournees/${token}/email`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ annonce }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec");
      toast.success(`${annonce ? "Annonce d'enlèvement" : "Feuille de route"} envoyée à ${j.to}`);
    } catch (e) { toast.error(`Email : ${e instanceof Error ? e.message : ""}`); }
  };

  /** Réordonne une expédition dans son canal (échange l'ordre avec le voisin). */
  const reorder = async (exp: Expedition, dir: -1 | 1) => {
    const sameCanal = exps.filter((x) => x.canal === exp.canal).sort((a, b) => a.ordre - b.ordre);
    const i = sameCanal.findIndex((x) => x.id === exp.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sameCanal.length) return;
    const a = sameCanal[i], b = sameCanal[j];
    // Ordres distincts garantis : on repose des index séquentiels sur le canal.
    const reindexed = sameCanal.map((x, k) => ({ id: x.id, ordre: k }));
    const oa = reindexed.find((r) => r.id === a.id)!, ob = reindexed.find((r) => r.id === b.id)!;
    [oa.ordre, ob.ordre] = [ob.ordre, oa.ordre];
    setExps((cur) => cur.map((x) => { const r = reindexed.find((z) => z.id === x.id); return r ? { ...x, ordre: r.ordre } : x; }));
    await Promise.all([
      fetch(`/api/transport/expeditions/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordre: oa.ordre }) }),
      fetch(`/api/transport/expeditions/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordre: ob.ordre }) }),
    ]).catch(() => load());
  };

  const byCanal = useMemo(() => {
    const m: Record<string, Expedition[]> = { EXPORT: [], GMS: [], DIRECT: [] };
    for (const x of exps) (m[x.canal] ?? (m[x.canal] = [])).push(x);
    return m;
  }, [exps]);

  // Priorité export : reste-t-il des export non expédiées ?
  const exportPending = byCanal.EXPORT.filter((x) => x.statut === "A_PREPARER" || x.statut === "PREPAREE");
  const clotureExport = async () => {
    const toShip = byCanal.EXPORT.filter((x) => x.statut === "PREPAREE");
    if (toShip.length === 0) { toast.info("Aucune expédition export « Préparée » à expédier."); return; }
    setBusy(true);
    try {
      await Promise.all(toShip.map((x) => patch(x.id, { statut: "EXPEDIE" })));
      toast.success(`Départ export clôturé — ${toShip.length} expédition(s) passée(s) en « Expédié ».`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        kicker="Logistique · module transporteur"
        title="Expéditions du jour"
        help={<>Planifie les tournées et suis les expéditions. <b>Un clic sur une carte</b> fait avancer son statut (À préparer → Préparée → Expédié). L&apos;export part <b>avant 6h30</b>.</>}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setShowChauff((s) => !s)}>
              <Truck className="h-4 w-4" /> Chauffeurs & feuilles
            </Button>
            <Button variant="outline" size="sm" onClick={prefill} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Pré-remplir (BL du jour)
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/transport/expeditions/export?from=${date}&to=${date}`, "_blank")}
              title="Exporter les expéditions du jour (CSV)">
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button size="sm" onClick={() => setAdding((a) => !a)}><Plus /> Expédition</Button>
          </div>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <DateStepper value={date} onChange={setDate} className="w-full sm:w-[236px]" />
      </div>

      {/* Ajout manuel rapide */}
      {adding && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-card p-3">
          <Input value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="Client / point de livraison" className="flex-1 min-w-[200px]"
            onKeyDown={(e) => { if (e.key === "Enter") addManual(); }} autoFocus />
          <select value={newCanal} onChange={(e) => setNewCanal(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-body">
            {CANAUX.map((c) => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}
          </select>
          <Button size="sm" onClick={addManual} disabled={busy || !newClient.trim()}>Ajouter</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Annuler</Button>
        </div>
      )}

      {/* Chauffeurs & feuilles de route */}
      {showChauff && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Chauffeurs & feuilles de route</h3>
            <button type="button" onClick={() => setShowChauff(false)} className="text-[12px] text-muted-foreground hover:text-foreground">Fermer</button>
          </div>
          {/* Ajouter un chauffeur */}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={newChaufNom} onChange={(e) => setNewChaufNom(e.target.value)} placeholder="Nom" className="w-36" />
            <select value={newChaufType} onChange={(e) => setNewChaufType(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-body">
              <option value="INTERNE">Interne</option>
              <option value="EXTERIEUR">Extérieur</option>
            </select>
            <Input value={newChaufSociete} onChange={(e) => setNewChaufSociete(e.target.value)} placeholder="Société (ext.)" className="w-36" />
            <Input value={newChaufEmail} onChange={(e) => setNewChaufEmail(e.target.value)} placeholder="Email (feuille de route)" className="w-52" />
            <Button size="sm" onClick={addChauffeur} disabled={!newChaufNom.trim()}><Plus className="h-4 w-4" /> Ajouter</Button>
          </div>
          {/* Liste + actions feuille de route */}
          <ul className="divide-y divide-border/60">
            {chauffeurs.map((c) => {
              const n = exps.filter((x) => x.chauffeurId === c.id).length;
              return (
                <li key={c.id} className="py-2 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{c.nom}</span>
                  <span className="text-[11px] text-muted-foreground">{c.type === "INTERNE" ? "interne" : (c.societe || "extérieur")}</span>
                  {c.actif === false && <span className="text-[10px] rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">inactif</span>}
                  <span className="text-[12px] tnum text-muted-foreground">· {n} expédition{n > 1 ? "s" : ""}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button size="sm" variant="outline" disabled={n === 0} onClick={() => openFeuille(c.id)}>Ouvrir feuille</Button>
                    <Button size="sm" variant="outline" disabled={n === 0 || !c.email} title={c.email ? "Envoyer la feuille de route" : "Renseigne l'email du chauffeur"} onClick={() => emailFeuille(c.id, false)}>Envoyer</Button>
                    <Button size="sm" variant="ghost" disabled={n === 0 || !c.email} title="Annonce d'enlèvement" onClick={() => emailFeuille(c.id, true)}>Annonce</Button>
                  </div>
                </li>
              );
            })}
            {chauffeurs.length === 0 && <li className="py-2 text-[12.5px] italic text-muted-foreground">Aucun chauffeur — ajoute-en un ci-dessus.</li>}
          </ul>
        </div>
      )}

      {/* Bandeau priorité EXPORT */}
      {byCanal.EXPORT.length > 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 ${exportPending.length > 0 ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"}`}>
          <span className="inline-flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            {exportPending.length > 0
              ? `Départ export avant 06:30 — ${exportPending.length} à traiter`
              : "Export : tout est expédié ✓"}
          </span>
          <Button size="sm" variant={exportPending.length > 0 ? "secondary" : "ghost"} onClick={clotureExport} disabled={busy}
            className={exportPending.length > 0 ? "" : "text-white hover:bg-white/10"}>
            <PackageCheck className="h-4 w-4" /> Clôturer le départ export
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : exps.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-[14px]">
          Aucune expédition ce jour. <b>Pré-remplis depuis les BL du jour</b> ou ajoute une expédition.
        </p>
      ) : (
        <div className="space-y-6">
          {CANAUX.filter((c) => byCanal[c]?.length).map((canal) => (
            <section key={canal} className="space-y-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                {CANAL_LABEL[canal]} <span className="tnum text-muted-foreground/60">({byCanal[canal].length})</span>
              </h2>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {byCanal[canal].map((x) => (
                  <ExpeditionCard key={x.id} x={x} chauffeurs={chauffeurs}
                    onAdvance={() => advance(x)}
                    onPatch={(b) => patch(x.id, b)}
                    onRemove={() => removeExp(x.id)}
                    onReorder={(dir) => reorder(x, dir)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Cartouche d'expédition — le corps est un bouton (clic = étape suivante). Les
 *  contrôles secondaires (T°C, chauffeur, incident, suppr.) stoppent la propagation. */
function ExpeditionCard({ x, chauffeurs, onAdvance, onPatch, onRemove, onReorder }: {
  x: Expedition; chauffeurs: Chauffeur[];
  onAdvance: () => void; onPatch: (b: Record<string, unknown>) => void; onRemove: () => void;
  onReorder: (dir: -1 | 1) => void;
}) {
  const ui = STATUT_UI[x.statut] ?? STATUT_UI.A_PREPARER;
  const [temp, setTemp] = useState<number | null>(x.tempChargement);
  useEffect(() => { setTemp(x.tempChargement); }, [x.tempChargement]);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`rounded-2xl text-white shadow-card transition-colors ${ui.bg}`}>
      {/* Corps cliquable — avance le statut */}
      <button type="button" onClick={onAdvance} className="w-full text-left p-3.5 rounded-t-2xl focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-tight truncate">{x.clientNom}</div>
            <div className="text-[12px] text-white/85 mt-0.5 tnum">
              {x.numCommande ? <>BL {x.numCommande}</> : "—"}
              {x.colis != null && x.colis > 0 ? ` · ${x.colis} colis` : ""}
              {x.poidsKg != null && x.poidsKg > 0 ? ` · ${Math.round(x.poidsKg)} kg` : ""}
            </div>
            {x.creneau && <div className="text-[11px] text-white/80 mt-0.5">Créneau {x.creneau}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[12px] font-bold uppercase whitespace-nowrap">{STATUT_LABEL[x.statut]}</div>
            <div className="text-[10px] text-white/70 font-mono mt-0.5 whitespace-nowrap">{x.refSuivi}</div>
          </div>
        </div>
      </button>

      {/* Barre de contrôles — 2 rangées, grandes cibles tactiles (tablette/quai).
          Rangée 1 : chauffeur (pleine largeur). Rangée 2 : T°C + ordre + incident +
          suppression. stopPropagation pour ne pas avancer le statut. */}
      <div className="rounded-b-2xl bg-black/15 px-2.5 py-2 space-y-2" onClick={stop}>
        {/* Chauffeur */}
        <select
          value={x.chauffeurId ?? ""}
          onChange={(e) => onPatch({ chauffeurId: e.target.value || null })}
          className="h-10 w-full rounded-md border border-white/30 bg-white/10 px-2 text-[13px] text-white [&>option]:text-foreground"
          title="Chauffeur affecté"
        >
          <option value="">Chauffeur…</option>
          {chauffeurs.map((c) => <option key={c.id} value={c.id}>{c.nom}{c.societe ? ` (${c.societe})` : ""}</option>)}
        </select>
        <div className="flex items-center gap-2">
          {/* Température au chargement */}
          <span className="inline-flex items-center gap-1.5 flex-1 min-w-0" title="Température au chargement (°C)">
            <Thermometer className="h-4 w-4 shrink-0 text-white/80" />
            <NumberInput value={temp} onValueChange={setTemp} onBlur={() => { if (temp !== x.tempChargement) onPatch({ tempChargement: temp }); }}
              step={0.1} decimals={1} allowEmpty placeholder="°C"
              className="h-10 w-full min-w-0 text-right bg-white/10 border-white/30 text-white placeholder:text-white/60" />
          </span>
          {/* Ordre de passage */}
          <button type="button" title="Monter dans l'ordre de passage" onClick={() => onReorder(-1)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/30 bg-white/10 hover:bg-white/20 active:scale-95">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" title="Descendre dans l'ordre de passage" onClick={() => onReorder(1)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/30 bg-white/10 hover:bg-white/20 active:scale-95">
            <ArrowDown className="h-4 w-4" />
          </button>
          {/* Incident */}
          <button type="button" title="Signaler un incident"
            onClick={() => { if (x.statut !== "INCIDENT") { const note = window.prompt("Motif de l'incident :", x.observations ?? ""); if (note != null) onPatch({ statut: "INCIDENT", observations: note }); } else { onPatch({ statut: "A_PREPARER" }); } }}
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/30 active:scale-95 ${x.statut === "INCIDENT" ? "bg-white/25" : "bg-white/10 hover:bg-white/20"}`}>
            <AlertTriangle className="h-4 w-4" />
          </button>
          {/* Supprimer */}
          <button type="button" title="Supprimer" onClick={onRemove}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/30 bg-white/10 hover:bg-white/20 active:scale-95">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
