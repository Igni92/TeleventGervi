"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Target, CalendarPlus, Check, X, Phone, MapPin, ChevronRight, ArrowLeft, Plus, Search } from "lucide-react";
import {
  PIPELINE_STAGES, getStage, nextStage, stageLabel,
  LOST_REASONS, RDV_TYPES, NOTIFY_MINUTES_CHOICES, notifyLabel, DEFAULT_NOTIFY_MINUTES_BEFORE,
} from "@/lib/prospection";

type Row = {
  id: string; code: string; nom: string; city: string | null; zipCode: string | null;
  tel1: string | null; email: string | null; probaLabo: string | null;
  prospectStage: string | null; prospectOwner: string | null; qualifieLabo: boolean | null;
  prospectLostReason: string | null; nextRdvAt: string | null;
};

const PROBA_COLOR: Record<string, string> = {
  "Élevée": "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  "Moyenne-haute": "bg-lime-500/15 text-lime-300 ring-lime-500/30",
  "Moyenne": "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  "À qualifier": "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

export function ProspectionBoard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/prospection", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Erreur");
      setRows(j.rows as Row[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [importing, setImporting] = useState(false);
  async function doImport() {
    setImporting(true);
    try {
      const r = await fetch("/api/prospection/import", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success(`Import : ${j.inserted} ajoutés · ${j.already} déjà présents`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setImporting(false); }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.nom} ${r.city ?? ""} ${r.code}`.toLowerCase().includes(s));
  }, [rows, q]);

  const byStage = useCallback((key: string) => filtered.filter((r) => r.prospectStage === key), [filtered]);
  const sel = rows.find((r) => r.id === selId) ?? null;

  async function patch(id: string, body: Record<string, unknown>, okMsg?: string) {
    const prev = rows;
    // maj optimiste de l'étape
    if (typeof body.stage === "string") {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, prospectStage: body.stage as string } : r)));
    }
    try {
      const r = await fetch(`/api/prospection/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      if (okMsg) toast.success(okMsg);
      if (!body.stage) load();
    } catch (e) {
      setRows(prev);
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }

  function onDrop(stageKey: string) {
    if (dragId) { patch(dragId, { stage: stageKey }, `Déplacé vers « ${stageLabel(stageKey)} »`); setDragId(null); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Barre d'outils */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/accueil" title="Retour à l'accueil"
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-white/70 hover:bg-white/[0.08]">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Link>
        <div className="flex items-center gap-2 text-white/90">
          <Target className="h-5 w-5 text-brand-400" />
          <h1 className="text-[17px] font-bold">Prospection</h1>
          <span className="text-white/40 text-[13px]">{rows.length} en pipeline</span>
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer la pipeline…"
          className="ml-auto h-9 w-52 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button onClick={() => setPoolOpen(true)}
          className="h-9 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 text-[13px] text-white font-semibold">
          <Plus className="h-4 w-4" /> Ajouter des prospects
        </button>
        <button onClick={doImport} disabled={importing} title="Recharger le vivier depuis le fichier (admin)"
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-white/70 hover:bg-white/[0.08] disabled:opacity-60">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Recharger le vivier"}
        </button>
      </div>

      {err && <div className="rounded-lg bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30 px-3 py-2 text-[13px]">{err} — la migration prospection est-elle appliquée ?</div>}

      {loading ? (
        <div className="flex-1 grid place-items-center text-white/50"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
      <div className="flex-1 min-h-0 flex gap-3">
        {/* Colonnes Kanban */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="flex gap-3 h-full min-h-0" style={{ minWidth: PIPELINE_STAGES.length * 240 }}>
            {PIPELINE_STAGES.map((st) => {
              const items = byStage(st.key);
              return (
                <div key={st.key}
                  onDragOver={(e) => { if (dragId) e.preventDefault(); }}
                  onDrop={() => onDrop(st.key)}
                  className="flex-1 min-w-[224px] flex flex-col rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]"
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                    <span className="text-[12.5px] font-semibold text-white/85">{st.label}</span>
                    <span className="ml-auto text-[11px] text-white/40 tabular-nums">{items.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {items.map((r) => (
                      <button key={r.id} draggable
                        onDragStart={() => setDragId(r.id)} onDragEnd={() => setDragId(null)}
                        onClick={() => setSelId(r.id)}
                        className={`w-full text-left rounded-lg bg-[#11161f] ring-1 px-2.5 py-2 transition-colors hover:ring-brand-500/40 ${
                          selId === r.id ? "ring-brand-500" : "ring-white/[0.07]"} ${dragId === r.id ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-start gap-1.5">
                          <span className="text-[12.5px] font-semibold text-white/90 leading-tight flex-1">{r.nom}</span>
                          {r.qualifieLabo && <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {r.city && <span className="text-[10.5px] text-white/45">{r.city}</span>}
                          {r.probaLabo && (
                            <span className={`text-[9.5px] px-1.5 py-0.5 rounded ring-1 ${PROBA_COLOR[r.probaLabo] ?? PROBA_COLOR["À qualifier"]}`}>
                              labo {r.probaLabo.toLowerCase()}
                            </span>
                          )}
                          {r.nextRdvAt && (
                            <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30">
                              RDV {new Date(r.nextRdvAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                    {items.length === 0 && <p className="text-[11px] text-white/25 italic px-1 py-2">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panneau fiche + script */}
        {sel && <FichePanel key={sel.id} row={sel} onClose={() => setSelId(null)} onPatch={patch} onReload={load} />}
      </div>
      )}

      {poolOpen && <AddProspectsPanel onClose={() => setPoolOpen(false)} onAdded={load} />}
    </div>
  );
}

type PoolRow = { id: string; code: string; nom: string; city: string | null; zipCode: string | null; probaLabo: string | null };

function AddProspectsPanel({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("proba");
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, sort, limit: "100" });
      const r = await fetch(`/api/prospection/pool?${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Erreur");
      setRows(j.rows as PoolRow[]); setTotal(j.total ?? 0); setSel(new Set());
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setLoading(false); }
  }, [search, sort]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function add(body: Record<string, unknown>, label: string) {
    setAdding(true);
    try {
      const r = await fetch("/api/prospection/pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success(`${j.added} prospect${j.added > 1 ? "s" : ""} ajouté${j.added > 1 ? "s" : ""} à la pipeline (${label})`);
      onAdded(); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setAdding(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="w-[440px] max-w-[92vw] h-full overflow-y-auto bg-[#0f141c] ring-1 ring-white/10 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-bold text-white/90 flex-1">Ajouter des prospects</h2>
          <span className="text-[12px] text-white/45">{total} dans le vivier</span>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/35" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (nom, ville, CP)…"
              className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-3 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-[12px] text-white/80 px-2">
            <option value="proba">Proba labo</option>
            <option value="ville">Ville</option>
            <option value="nom">Nom</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-[12px]">
          <button disabled={adding || !sel.size} onClick={() => add({ ids: [...sel] }, "sélection")}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 h-8 text-white font-semibold disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Ajouter la sélection ({sel.size})
          </button>
          <button disabled={adding || !total} onClick={() => add({ all: true, search }, `${total} résultats`)}
            className="inline-flex items-center gap-1 rounded-lg ring-1 ring-white/10 px-3 h-8 text-white/80 hover:bg-white/[0.06] disabled:opacity-40">
            Tout ajouter ({total})
          </button>
        </div>

        {loading ? (
          <div className="grid place-items-center py-10 text-white/40"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => toggle(r.id)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 ring-1 flex items-center gap-2 transition-colors ${sel.has(r.id) ? "ring-brand-500 bg-brand-500/10" : "ring-white/[0.07] bg-[#11161f] hover:ring-white/20"}`}>
                  <span className={`h-4 w-4 shrink-0 rounded grid place-items-center ring-1 ${sel.has(r.id) ? "bg-brand-500 ring-brand-500" : "ring-white/20"}`}>
                    {sel.has(r.id) && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] text-white/90 truncate">{r.nom}</span>
                    <span className="block text-[10.5px] text-white/40">{[r.city, r.zipCode].filter(Boolean).join(" · ")}</span>
                  </span>
                  {r.probaLabo && <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60">{r.probaLabo}</span>}
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="text-[12px] text-white/35 italic py-6 text-center">Aucun prospect dans le vivier pour cette recherche.</li>}
            {total > rows.length && <li className="text-[11px] text-white/35 text-center pt-1">{rows.length} affichés sur {total} — affinez la recherche ou « Tout ajouter ».</li>}
          </ul>
        )}
      </aside>
    </div>
  );
}

function FichePanel({ row, onClose, onPatch, onReload }: {
  row: Row; onClose: () => void;
  onPatch: (id: string, body: Record<string, unknown>, okMsg?: string) => Promise<void>;
  onReload: () => void;
}) {
  const stage = getStage(row.prospectStage);
  const next = nextStage(row.prospectStage);
  const [note, setNote] = useState("");
  const [rdvOpen, setRdvOpen] = useState(false);

  return (
    <aside className="w-[360px] shrink-0 overflow-y-auto rounded-xl bg-[#0f141c] ring-1 ring-white/[0.08] p-4 space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-[15px] font-bold text-white/90 leading-tight">{row.nom}</h2>
          <p className="text-[12px] text-white/45">{[row.city, row.zipCode].filter(Boolean).join(" · ")}</p>
        </div>
        <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] px-2 py-1 rounded-lg ring-1 ring-white/10 text-white/80" style={{ background: (stage?.color ?? "#334") + "22" }}>
          {stage?.label ?? "—"}
        </span>
        {row.tel1 && <a href={`tel:${row.tel1}`} className="text-[11px] inline-flex items-center gap-1 text-white/70 hover:text-white"><Phone className="h-3 w-3" />{row.tel1}</a>}
        <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(`${row.nom} ${row.city ?? ""} téléphone`)}`}
          className="text-[11px] inline-flex items-center gap-1 text-brand-300 hover:underline"><MapPin className="h-3 w-3" />Trouver le tél</a>
      </div>

      {/* Script de l'étape */}
      {stage && (
        <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] p-3">
          <p className="text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1.5">Script — {stage.label}</p>
          <p className="text-[12.5px] text-white/80 whitespace-pre-line leading-relaxed">{stage.script}</p>
        </div>
      )}

      {/* Qualif labo */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-white/60">Labo pâtisserie&nbsp;:</span>
        <button onClick={() => onPatch(row.id, { qualifieLabo: true }, "Qualifié : labo OK")}
          className={`text-[12px] px-2.5 py-1 rounded-lg ring-1 ${row.qualifieLabo === true ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40" : "ring-white/10 text-white/60 hover:bg-white/[0.06]"}`}>Oui</button>
        <button onClick={() => onPatch(row.id, { qualifieLabo: false }, "Marqué : pas de labo")}
          className={`text-[12px] px-2.5 py-1 rounded-lg ring-1 ${row.qualifieLabo === false ? "bg-rose-500/20 text-rose-300 ring-rose-500/40" : "ring-white/10 text-white/60 hover:bg-white/[0.06]"}`}>Non</button>
      </div>

      {/* Actions d'étape */}
      <div className="flex flex-wrap gap-2">
        {next && (
          <button onClick={() => onPatch(row.id, { stage: next }, `→ ${stageLabel(next)}`)}
            className="inline-flex items-center gap-1 text-[12.5px] px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold">
            {stageLabel(next)} <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={() => setRdvOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[12.5px] px-3 py-1.5 rounded-lg ring-1 ring-white/10 text-white/80 hover:bg-white/[0.06]">
          <CalendarPlus className="h-3.5 w-3.5" /> Rendez-vous
        </button>
        <select onChange={(e) => { if (e.target.value) onPatch(row.id, { stage: "PERDU", lostReason: e.target.value }, "Marqué perdu"); }}
          defaultValue="" className="text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/70">
          <option value="" disabled>Perdu…</option>
          {LOST_REASONS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {rdvOpen && <RdvForm clientId={row.id} defaultTitle={row.nom} onDone={() => { setRdvOpen(false); onReload(); }} />}

      {/* Note rapide */}
      <div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ajouter une note…"
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        <button disabled={!note.trim()} onClick={() => { onPatch(row.id, { note }, "Note ajoutée"); setNote(""); }}
          className="mt-1.5 text-[12px] px-3 py-1 rounded-lg ring-1 ring-white/10 text-white/70 hover:bg-white/[0.06] disabled:opacity-40">Enregistrer la note</button>
      </div>
    </aside>
  );
}

function RdvForm({ clientId, defaultTitle, onDone }: { clientId: string; defaultTitle: string; onDone: () => void }) {
  const [type, setType] = useState("R1_PHYSIQUE");
  const [startAt, setStartAt] = useState("");
  const [location, setLocation] = useState("");
  const [notify, setNotify] = useState(DEFAULT_NOTIFY_MINUTES_BEFORE);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!startAt) { toast.error("Choisissez une date/heure"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/rendez-vous", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, title: defaultTitle, type, startAt: new Date(startAt).toISOString(), location, notifyMinutesBefore: notify }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success("Rendez-vous créé");
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/80">
          {RDV_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={notify} onChange={(e) => setNotify(Number(e.target.value))} className="text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/80" title="Notification avant le RDV">
          {NOTIFY_MINUTES_CHOICES.map((m) => <option key={m} value={m}>Notif {notifyLabel(m)}</option>)}
        </select>
      </div>
      <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
        className="w-full text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/80" />
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lieu (adresse magasin)…"
        className="w-full text-[12px] px-2 py-1.5 rounded-lg bg-white/[0.04] ring-1 ring-white/10 text-white/80 placeholder:text-white/30" />
      <button disabled={saving} onClick={save}
        className="w-full inline-flex items-center justify-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />} Créer le rendez-vous
      </button>
    </div>
  );
}
