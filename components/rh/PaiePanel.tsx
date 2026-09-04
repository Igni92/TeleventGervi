"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight, CalendarRange, Plus, Trash2, Send } from "lucide-react";
import { fmtHM } from "@/lib/rh/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type El = { id: string; employeeId: string; type: string; label: string | null; montant: number; statut: string };
type Sugg = { type: string; label: string; montant: number };
type Row = { employeeId: string; name: string; poste: string | null; workedMin: number; elements: El[]; elementsTotal: number };
type Data = { mois: string; types: string[]; rows: Row[]; sends: { id: string; sentAt: string; sentBy: string | null }[]; suggestions?: Record<string, Sugg[]> };

const TYPE_LABEL: Record<string, string> = {
  prime: "Prime", frais: "Frais", treizieme: "13e mois", vehicule_an: "Avantage véhicule", recup_paye: "Récup payée", commission: "Commission", autre: "Autre",
};
const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

/** Paie / Éléments de salaires (RH V2) — heures du mois (badgeuse) + éléments
 *  variables à transmettre à la compta. Remplace l'ancien onglet Salaires. */
export function PaiePanel({ initialMonth }: { initialMonth: string }) {
  const [mois, setMois] = useState(initialMonth);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: string; label: string; montant: string }>({ type: "prime", label: "", montant: "" });

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/rh/paie?mois=${m}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.ok) setData(j);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(mois); }, [mois, load]);

  const shift = (n: number) => {
    const [y, m] = mois.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMois(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const addElement = async (employeeId: string) => {
    const montant = Number(form.montant.replace(",", "."));
    if (!Number.isFinite(montant)) { toast.error("Montant invalide"); return; }
    const r = await fetch("/api/rh/paie", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", employeeId, mois, type: form.type, label: form.label || null, montant }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
    toast.success("Élément ajouté"); setAddFor(null); setForm({ type: "prime", label: "", montant: "" }); load(mois);
  };
  const delElement = async (id: string) => {
    await fetch("/api/rh/paie", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    load(mois);
  };
  const addSuggestion = async (employeeId: string, s: Sugg) => {
    const r = await fetch("/api/rh/paie", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", employeeId, mois, type: s.type, label: s.label, montant: s.montant }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
    toast.success("Élément ajouté"); load(mois);
  };
  const sendRecap = async () => {
    if (!confirm(`Marquer les éléments de ${monthLabel(mois)} comme envoyés à la compta ?`)) return;
    const r = await fetch("/api/rh/paie", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", mois, to: [] }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
    toast.success("Récap marqué envoyé"); load(mois);
  };

  const grandTotal = useMemo(() => (data?.rows ?? []).reduce((s, r) => s + r.elementsTotal, 0), [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shift(-1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 h-9 text-[13px] font-semibold text-foreground capitalize"><CalendarRange className="h-4 w-4 text-muted-foreground" /> {monthLabel(mois)}</span>
          <button type="button" onClick={() => shift(1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted-foreground">Total variables : <b className="text-foreground tnum">{eur(grandTotal)}</b></span>
          <Button size="sm" variant="outline" onClick={sendRecap}><Send className="h-3.5 w-3.5" /> Envoyer à la compta</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Aucun salarié actif.</p>
      ) : (
        <ul className="space-y-2">
          {data.rows.map((r) => (
            <li key={r.employeeId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="ml-2 text-[12px] text-muted-foreground">Heures du mois : <b className="text-foreground tnum">{fmtHM(r.workedMin)}</b></span>
                </div>
                <div className="flex items-center gap-2">
                  {r.elementsTotal !== 0 && <span className="text-[13px] tnum text-foreground">{eur(r.elementsTotal)}</span>}
                  <Button size="sm" variant="outline" onClick={() => { setAddFor(addFor === r.employeeId ? null : r.employeeId); setForm({ type: "prime", label: "", montant: "" }); }}><Plus className="h-3.5 w-3.5" /> Élément</Button>
                </div>
              </div>

              {r.elements.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                  {r.elements.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-foreground">{TYPE_LABEL[e.type] ?? e.type}{e.label ? ` · ${e.label}` : ""}
                        {e.statut === "envoye" && <span className="ml-2 text-[10px] rounded px-1.5 py-0.5 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">envoyé</span>}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="tnum text-foreground">{eur(e.montant)}</span>
                        <button type="button" onClick={() => delElement(e.id)} title="Supprimer" className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Suggestions automatiques (demi-13e, régularisation annualisation) */}
              {(data.suggestions?.[r.employeeId] ?? []).filter((s) => !r.elements.some((e) => e.label === s.label)).length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
                  <span className="text-[11px] text-muted-foreground">Suggéré :</span>
                  {(data.suggestions?.[r.employeeId] ?? []).filter((s) => !r.elements.some((e) => e.label === s.label)).map((s, k) => (
                    <button key={k} type="button" onClick={() => addSuggestion(r.employeeId, s)}
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-500/40 bg-brand-500/[0.06] px-2 py-1 text-[11.5px] text-foreground hover:bg-brand-500/12">
                      <Plus className="h-3 w-3" /> {s.label} · {eur(s.montant)}
                    </button>
                  ))}
                </div>
              )}

              {addFor === r.employeeId && (
                <div className="mt-2 flex items-end gap-2 flex-wrap border-t border-border/60 pt-2">
                  <label className="block"><span className="text-caption text-muted-foreground">Type</span>
                    <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="mt-0.5 h-9 rounded-md border border-input bg-background px-2 text-body">
                      {data.types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
                    </select>
                  </label>
                  <label className="block flex-1 min-w-[140px]"><span className="text-caption text-muted-foreground">Libellé (option)</span>
                    <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} className="mt-0.5 h-9" placeholder="ex. Prime de fin de saison" />
                  </label>
                  <label className="block"><span className="text-caption text-muted-foreground">Montant €</span>
                    <Input value={form.montant} onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))} className="mt-0.5 h-9 w-28" placeholder="0,00" inputMode="decimal" />
                  </label>
                  <Button size="sm" onClick={() => addElement(r.employeeId)}><Plus className="h-3.5 w-3.5" /> Ajouter</Button>
                  <button type="button" onClick={() => setAddFor(null)} className="text-[12px] text-muted-foreground hover:text-foreground">Annuler</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data?.sends && data.sends.length > 0 && (
        <p className="text-center text-[11px] text-muted-foreground">Dernier envoi compta : {new Date(data.sends[0].sentAt).toLocaleString("fr-FR")}{data.sends[0].sentBy ? ` · ${data.sends[0].sentBy}` : ""}</p>
      )}
      <p className="text-center text-[11px] text-muted-foreground">Heures du mois = somme des pointages badgeuse. Les éléments variables sont transmis à la comptabilité pour le bulletin.</p>
    </div>
  );
}

function monthLabel(mois: string): string {
  const [y, m] = mois.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}
