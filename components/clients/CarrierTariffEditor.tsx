"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, MapPin, Percent, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BRACKET_UNIT_LABELS,
  computePositionCost,
  emptyTariff,
  normDept,
  tariffIsUsable,
  tariffTemplateFor,
  zoneForDepartement,
  type BracketUnit,
  type CarrierTariff,
  type TariffBracket,
  type TariffExtraLine,
  type TariffZone,
} from "@/lib/carrierTariff";

/**
 * Éditeur de GRILLE TARIFAIRE d'un transporteur externe — coût PAR POSITION :
 * tranches de poids MODIFIABLES (0–50, 51–100 kg…) × zones de départements,
 * plus lignes annexes fixes (€) et en % (majoration gazole du mois…).
 *
 * La grille est GLOBALE au transporteur (partagée entre tous les clients) ;
 * le département du client met en évidence la zone qui s'applique à lui.
 * Pré-remplissage possible depuis les tarifs fournisseurs analysés (Delanchy
 * 2025, Antoine 01/2026). Sauvegarde : PUT /api/transport/tarifs (direction).
 */

const fmtE = (v: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

const uid = () => Math.random().toString(36).slice(2, 9);

function bracketLabel(b: TariffBracket): string {
  return b.maxKg == null ? `${b.minKg} kg et +` : `${b.minKg}–${b.maxKg} kg`;
}

const inputCls =
  "h-7 rounded-md border border-input bg-background px-1.5 text-right text-[12px] tnum text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function CarrierTariffEditor({
  carrierCode,
  carrierName,
  initialTariff,
  clientDept,
  canEdit,
  onSaved,
}: {
  carrierCode: string;
  carrierName: string;
  initialTariff: CarrierTariff | null;
  /** Département du client (code postal SAP) — met en évidence sa zone. */
  clientDept: string | null;
  canEdit: boolean;
  onSaved?: (t: CarrierTariff) => void;
}) {
  const [tariff, setTariff] = useState<CarrierTariff | null>(initialTariff);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Sur la fiche d'UN client on n'affiche QUE SA zone (grille complète sur
  // demande) — la grille reste globale au transporteur.
  const [showAllZones, setShowAllZones] = useState(false);

  const template = tariffTemplateFor(carrierCode);
  const clientZone = tariff ? zoneForDepartement(tariff.zones, clientDept) : null;
  // Aperçu pour le client : coût d'une position de 100 kg dans sa zone.
  const preview = tariff && clientDept ? computePositionCost(tariff, clientDept, 100) : null;

  const mut = (fn: (t: CarrierTariff) => CarrierTariff) => {
    setTariff((t) => (t ? fn(t) : t));
    setDirty(true);
  };

  async function save() {
    if (!tariff) return;
    setSaving(true);
    try {
      const r = await fetch("/api/transport/tarifs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tariff }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de l'enregistrement");
      setTariff(j.tariff ?? tariff);
      setDirty(false);
      toast.success(`Grille ${carrierName} enregistrée`);
      if (j.tariff) onSaved?.(j.tariff);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  /* ── Pas encore de grille : proposer le pré-remplissage ── */
  if (!tariff) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] text-foreground truncate">{carrierName}</p>
            <p className="text-[10.5px] text-muted-foreground truncate">Code {carrierCode} · aucune grille saisie</p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-1.5 shrink-0">
              {template && (
                <Button size="sm" variant="secondary" className="h-7 text-[11px]"
                  onClick={() => { setTariff(template); setOpen(true); setDirty(true); }}>
                  <Wand2 className="h-3.5 w-3.5" /> Pré-remplir (tarif fournisseur)
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-[11px]"
                onClick={() => { setTariff(emptyTariff(carrierCode)); setOpen(true); setDirty(true); }}>
                <Plus className="h-3.5 w-3.5" /> Grille vierge
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/80">
      {/* En-tête repliable : résumé + tarif applicable au client */}
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 p-2.5 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground truncate inline-flex items-center gap-1.5">
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {carrierName}
            {dirty && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">· non enregistré</span>}
          </p>
          <p className="text-[10.5px] text-muted-foreground truncate pl-5">
            Code {carrierCode} · {tariff.brackets.length} tranche{tariff.brackets.length > 1 ? "s" : ""} ·{" "}
            {tariff.zones.length} zone{tariff.zones.length > 1 ? "s" : ""}
            {!tariffIsUsable(tariff) && " · grille incomplète"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {clientDept ? (
            clientZone ? (
              <>
                <p className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Dépt {clientDept} · {clientZone.label || "zone"}
                </p>
                {preview && (
                  <p className="text-[10.5px] text-muted-foreground tnum">
                    ex. 100 kg → {fmtE(preview.total)} € / position
                  </p>
                )}
              </>
            ) : (
              <p className="text-[10.5px] text-muted-foreground inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Dépt {clientDept} hors zones
              </p>
            )
          ) : (
            <p className="text-[10.5px] text-muted-foreground">CP client inconnu</p>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/60 p-2.5 space-y-3">
          {/* ── Tranches de poids (modifiables) ── */}
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1.5">
              Tranches de poids (livré)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tariff.brackets.map((b) => (
                <div key={b.id} className="flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 px-1.5 py-1">
                  <input type="number" min={0} className={`${inputCls} w-14`} value={b.minKg}
                    disabled={!canEdit} aria-label="Borne basse (kg)"
                    onChange={(e) => mut((t) => ({ ...t, brackets: t.brackets.map((x) => x.id === b.id ? { ...x, minKg: parseFloat(e.target.value) || 0 } : x) }))} />
                  <span className="text-[11px] text-muted-foreground">–</span>
                  <input type="number" min={0} className={`${inputCls} w-14`} value={b.maxKg ?? ""}
                    placeholder="∞" disabled={!canEdit} aria-label="Borne haute (kg)"
                    onChange={(e) => mut((t) => ({ ...t, brackets: t.brackets.map((x) => x.id === b.id ? { ...x, maxKg: e.target.value === "" ? null : (parseFloat(e.target.value) || 0) } : x) }))} />
                  <span className="text-[11px] text-muted-foreground">kg</span>
                  <select
                    className="h-7 rounded-md border border-input bg-background px-1 text-[11px] text-foreground disabled:opacity-60"
                    value={b.unit} disabled={!canEdit} aria-label="Unité de la tranche"
                    onChange={(e) => mut((t) => ({ ...t, brackets: t.brackets.map((x) => x.id === b.id ? { ...x, unit: e.target.value as BracketUnit } : x) }))}
                  >
                    <option value="position">{BRACKET_UNIT_LABELS.position}</option>
                    <option value="per100kg">{BRACKET_UNIT_LABELS.per100kg}</option>
                  </select>
                  {canEdit && (
                    <button type="button" aria-label="Supprimer la tranche"
                      className="text-muted-foreground hover:text-rose-500"
                      onClick={() => mut((t) => ({
                        ...t,
                        brackets: t.brackets.filter((x) => x.id !== b.id),
                        zones: t.zones.map((z) => { const p = { ...z.prices }; delete p[b.id]; return { ...z, prices: p }; }),
                      }))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <Button size="sm" variant="outline" className="h-8 text-[11px]"
                  onClick={() => mut((t) => {
                    const last = [...t.brackets].sort((a, b2) => (a.maxKg ?? Infinity) - (b2.maxKg ?? Infinity)).at(-1);
                    const min = last?.maxKg != null ? last.maxKg + 1 : 0;
                    return { ...t, brackets: [...t.brackets, { id: `b-${uid()}`, minKg: min, maxKg: null, unit: "position" as const }] };
                  })}>
                  <Plus className="h-3.5 w-3.5" /> Tranche
                </Button>
              )}
            </div>
          </div>

          {/* ── Zones (départements) × prix par tranche — par défaut, seule la
                 zone du CLIENT est montrée (bascule pour la grille complète) ── */}
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1.5">
              {clientZone && !showAllZones ? "Zone du client — prix par tranche" : "Zones livrées (départements) — prix par tranche"}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-2 font-semibold min-w-[130px]">Départements</th>
                    {tariff.brackets.map((b) => (
                      <th key={b.id} className="py-1 px-1 font-semibold text-right whitespace-nowrap">
                        {bracketLabel(b)}
                        <span className="block font-normal normal-case tracking-normal text-[9.5px]">{BRACKET_UNIT_LABELS[b.unit]}</span>
                      </th>
                    ))}
                    {canEdit && <th className="w-6" />}
                  </tr>
                </thead>
                <tbody>
                  {(clientZone && !showAllZones ? tariff.zones.filter((z) => z.id === clientZone.id) : tariff.zones).map((z) => {
                    const isClientZone = clientZone?.id === z.id;
                    return (
                      <tr key={z.id} className={`border-t border-border/40 ${isClientZone ? "bg-brand-500/5" : ""}`}>
                        <td className="py-1 pr-2 align-top">
                          <input type="text" disabled={!canEdit}
                            className="h-7 w-full min-w-[120px] rounded-md border border-input bg-background px-1.5 text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                            value={z.departements.join(", ")} placeholder="75, 92, 93…"
                            aria-label="Départements de la zone (séparés par des virgules)"
                            onChange={(e) => mut((t) => ({
                              ...t,
                              zones: t.zones.map((x) => x.id === z.id
                                ? { ...x, departements: e.target.value.split(/[,;\s]+/).filter(Boolean), label: x.label }
                                : x),
                            }))}
                            onBlur={(e) => mut((t) => ({
                              ...t,
                              zones: t.zones.map((x) => x.id === z.id
                                ? {
                                    ...x,
                                    departements: [...new Set(e.target.value.split(/[,;\s]+/).map(normDept).filter(Boolean))],
                                    label: x.label || `Dépt ${e.target.value}`,
                                  }
                                : x),
                            }))} />
                          {isClientZone && (
                            <span className="text-[9.5px] font-semibold text-brand-600 dark:text-brand-400 inline-flex items-center gap-0.5 mt-0.5">
                              <MapPin className="h-2.5 w-2.5" /> zone du client
                            </span>
                          )}
                        </td>
                        {tariff.brackets.map((b) => (
                          <td key={b.id} className="py-1 px-1 text-right align-top">
                            <input type="number" min={0} step={0.01} disabled={!canEdit}
                              className={`${inputCls} w-20`}
                              value={z.prices[b.id] ?? ""} placeholder="—"
                              aria-label={`Prix ${bracketLabel(b)} (${BRACKET_UNIT_LABELS[b.unit]})`}
                              onChange={(e) => mut((t) => ({
                                ...t,
                                zones: t.zones.map((x) => {
                                  if (x.id !== z.id) return x;
                                  const prices = { ...x.prices };
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v > 0) prices[b.id] = v; else delete prices[b.id];
                                  return { ...x, prices };
                                }),
                              }))} />
                          </td>
                        ))}
                        {canEdit && (
                          <td className="py-1 text-right align-top">
                            <button type="button" aria-label="Supprimer la zone"
                              className="text-muted-foreground hover:text-rose-500 mt-1.5"
                              onClick={() => mut((t) => ({ ...t, zones: t.zones.filter((x) => x.id !== z.id) }))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              {clientZone && tariff.zones.length > 1 && (
                <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                  onClick={() => setShowAllZones((v) => !v)}>
                  {showAllZones ? "Ne montrer que la zone du client" : `Toutes les zones (${tariff.zones.length})`}
                </Button>
              )}
              {canEdit && (showAllZones || !clientZone) && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]"
                  onClick={() => mut((t) => ({ ...t, zones: [...t.zones, { id: `z-${uid()}`, label: "", departements: [], prices: {} } as TariffZone] }))}>
                  <Plus className="h-3.5 w-3.5" /> Zone
                </Button>
              )}
            </div>
          </div>

          {/* ── Lignes annexes : fixes (€) et majorations (%) ── */}
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1.5">
              Lignes annexes — fixes (€ / envoi) et majorations (%)
            </p>
            <ul className="space-y-1.5">
              {tariff.extras.map((x) => (
                <li key={x.id} className="flex items-center gap-1.5">
                  <input type="text" disabled={!canEdit}
                    className="h-7 flex-1 min-w-0 rounded-md border border-input bg-background px-1.5 text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    value={x.label} placeholder="Libellé (ex. Majoration gazole)"
                    aria-label="Libellé de la ligne"
                    onChange={(e) => mut((t) => ({ ...t, extras: t.extras.map((l) => l.id === x.id ? { ...l, label: e.target.value } : l) }))} />
                  <select
                    className="h-7 rounded-md border border-input bg-background px-1 text-[11px] text-foreground disabled:opacity-60"
                    value={x.kind} disabled={!canEdit} aria-label="Type de ligne"
                    onChange={(e) => mut((t) => ({ ...t, extras: t.extras.map((l) => l.id === x.id ? { ...l, kind: e.target.value as TariffExtraLine["kind"] } : l) }))}
                  >
                    <option value="fixed">€ fixe</option>
                    <option value="percent">%</option>
                  </select>
                  <input type="number" min={0} step={0.01} disabled={!canEdit}
                    className={`${inputCls} w-20`} value={x.value || ""}
                    placeholder="0" aria-label={x.kind === "percent" ? "Pourcentage" : "Montant €"}
                    onChange={(e) => mut((t) => ({ ...t, extras: t.extras.map((l) => l.id === x.id ? { ...l, value: parseFloat(e.target.value) || 0 } : l) }))} />
                  <span className="w-7 text-[11px] text-muted-foreground">{x.kind === "percent" ? "%" : "€"}</span>
                  {canEdit && (
                    <button type="button" aria-label="Supprimer la ligne"
                      className="text-muted-foreground hover:text-rose-500"
                      onClick={() => mut((t) => ({ ...t, extras: t.extras.filter((l) => l.id !== x.id) }))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Button size="sm" variant="outline" className="h-7 text-[11px]"
                  onClick={() => mut((t) => ({ ...t, extras: [...t.extras, { id: `x-${uid()}`, label: "", kind: "fixed" as const, value: 0 }] }))}>
                  <Plus className="h-3.5 w-3.5" /> Ligne fixe (€)
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]"
                  onClick={() => mut((t) => ({ ...t, extras: [...t.extras, { id: `x-${uid()}`, label: "Majoration gazole (mois en vigueur)", kind: "percent" as const, value: 0 }] }))}>
                  <Percent className="h-3.5 w-3.5" /> Ligne %
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Coût position = prix de la tranche × (1 + Σ % ÷ 100) + Σ fixes. Majoration gazole :
              barème mensuel du transporteur (indices CNR —{" "}
              <a href="https://www.cnr.fr" target="_blank" rel="noreferrer" className="underline hover:text-foreground">cnr.fr</a>).
            </p>
          </div>

          {canEdit && (
            <div className="flex justify-end gap-1.5">
              {template && (
                <Button size="sm" variant="ghost" className="h-8 text-[11px]"
                  onClick={() => { setTariff(template); setDirty(true); }}>
                  <Wand2 className="h-3.5 w-3.5" /> Recharger le tarif fournisseur
                </Button>
              )}
              <Button size="sm" onClick={save} disabled={saving || !dirty} variant={dirty ? "default" : "secondary"}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer la grille
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
