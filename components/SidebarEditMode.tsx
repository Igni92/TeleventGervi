"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Check, ChevronDown, ChevronUp, Circle, CornerDownRight, FolderPlus,
  GripVertical, Loader2, Pencil, Plus, RotateCcw, Trash2,
} from "lucide-react";
import { NAV_GROUPS, flatNavItems, type NavItem } from "@/lib/navigation";
import {
  toNavEditState, fromNavEditState, moveNavRowBefore, swapNavRows,
  addNavCategory, addNavSubCategory, renameNavCategory, deleteNavCategory,
  moveNavCategory, moveNavCategoryBefore, swapNavCategory,
  type NavConfig, type NavEditGroup,
} from "@/lib/navOverrides";

/**
 * Mode MODIFICATION de la sidebar (crayon, admin) — extrait de Sidebar.tsx et
 * chargé par next/dynamic UNIQUEMENT à l'entrée en édition.
 *
 * Brouillon local : renommer les entrées, les glisser-déposer (insérer /
 * échanger), créer / renommer / supprimer des catégories et sous-catégories,
 * réordonner les blocs. Enregistrer = PUT /api/nav-overrides (réglage GLOBAL,
 * garde admin côté API).
 *
 * Tolérance : le brouillon est construit depuis les NAV_GROUPS ACTUELS — une
 * surcharge persistée qui référence une entrée disparue (ex. l'ancienne
 * « Console de commande » /console/ecran2, fusionnée dans /console) est
 * simplement ignorée, puis purgée au prochain enregistrement.
 */

/** Icône d'origine par route — l'entrée garde son icône même renommée/déplacée. */
const ICON_BY_HREF = new Map<string, NavItem["icon"]>(
  flatNavItems().map((it) => [it.href, it.icon]),
);

export default function SidebarEditMode({
  navConfig,
  onSaved,
  onClose,
}: {
  /** Config actuellement appliquée (source du brouillon). */
  navConfig: NavConfig;
  /** Enregistrement réussi — la config renvoyée par l'API est à appliquer. */
  onSaved: (config: NavConfig) => void;
  /** Sortie sans enregistrer. */
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NavEditGroup[]>(() => toNavEditState(NAV_GROUPS, navConfig));
  const [saving, setSaving] = useState(false);

  // Glisser-déposer des ENTRÉES : href tiré + zone survolée (`row:<href>`).
  const [dragHref, setDragHref] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // Glisser-déposer des CATÉGORIES de 1er niveau (bloc entier) — état séparé :
  // on ne mélange jamais les deux gestes.
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);

  const endDrag = () => { setDragHref(null); setOverKey(null); setOverCat(null); };
  const endCatDrag = () => { setDragCat(null); setOverCat(null); };
  const dropBefore = (toGroup: string, beforeHref: string | null) => {
    if (dragHref) setDraft((cur) => moveNavRowBefore(cur, dragHref, toGroup, beforeHref));
    endDrag();
  };
  const dropOnRow = (targetHref: string) => {
    if (dragHref && dragHref !== targetHref) setDraft((cur) => swapNavRows(cur, dragHref, targetHref));
    endDrag();
  };

  // Édition du LIBELLÉ (crayon) — une seule entrée/catégorie à la fois. Pour les
  // catégories, la clé = le libellé (renommer changerait la clé) : on bufferise
  // la saisie et on ne renomme qu'à la validation (garde le focus).
  const [editKey, setEditKey] = useState<string | null>(null);   // `row:<href>` | `cat:<label>`
  const [catDraftLabel, setCatDraftLabel] = useState("");
  const startEditCat = (label: string) => { setCatDraftLabel(label); setEditKey(`cat:${label}`); };
  const commitEditCat = (label: string) => {
    if (catDraftLabel.trim() && catDraftLabel.trim() !== label) renameCategory(label, catDraftLabel);
    setEditKey(null);
  };

  const renameDraft = (href: string, label: string) =>
    setDraft((cur) => cur.map((g) => ({ ...g, rows: g.rows.map((r) => (r.href === href ? { ...r, label } : r)) })));
  const addCategory = () => setDraft((cur) => addNavCategory(cur));
  const addSubCategory = (parent: string) => setDraft((cur) => addNavSubCategory(cur, parent));
  const renameCategory = (label: string, next: string) => setDraft((cur) => renameNavCategory(cur, label, next));
  const removeCategory = (label: string) => setDraft((cur) => deleteNavCategory(cur, label));
  const shiftCategory = (label: string, dir: -1 | 1) => setDraft((cur) => moveNavCategory(cur, label, dir));
  const dropCatBefore = (beforeLabel: string | null) => {
    if (dragCat) setDraft((cur) => moveNavCategoryBefore(cur, dragCat, beforeLabel));
    endCatDrag();
  };
  const swapCat = (target: string) => {
    if (dragCat && dragCat !== target) setDraft((cur) => swapNavCategory(cur, dragCat, target));
    endCatDrag();
  };

  async function save(config: NavConfig, successMsg: string) {
    setSaving(true);
    try {
      const r = await fetch("/api/nav-overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de l'enregistrement");
      toast.success(successMsg, { description: "Réglage global — les autres postes l'auront au prochain chargement." });
      onSaved(j.config ?? { items: {}, categories: [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2 pt-1 space-y-4">
        {draft.map((group) => {
          const isSub = !!group.parent;
          const canDelete = !!group.custom && group.rows.length === 0 && !draft.some((g) => g.parent === group.label);
          return (
            <div key={group.label} className={isSub ? "ml-2.5 border-l-[length:var(--hairline)] border-border pl-2 -mt-3" : ""}>
              {/* En-tête de catégorie — GLISSABLE en entier (1er niveau) pour la
                  réordonner. Renommer (créées) passe par le crayon (sinon glisser
                  = bouger le bloc, pas éditer). Réordonner (secours) · + sous-cat · suppr. */}
              {(() => {
                const catEditing = editKey === `cat:${group.label}`;
                const catDraggable = !isSub && !catEditing;
                // Une ENTRÉE glissée peut être déposée sur n'importe quel en-tête
                // (y compris sous-catégorie) → ajoutée EN BAS de cette catégorie.
                // Une CATÉGORIE glissée s'échange avec un autre en-tête de 1er
                // niveau. Surbrillance simple (cible possible) / forte (survol).
                const catSwapping = !isSub && !!dragCat && dragCat !== group.label;
                const catRowTarget = !!dragHref;   // une entrée cherche une catégorie d'accueil
                const rowIntoHover = overCat === `into:${group.label}`;
                return (
                  <div
                    draggable={catDraggable}
                    onDragStart={catDraggable ? (e) => { e.dataTransfer.effectAllowed = "move"; setDragCat(group.label); } : undefined}
                    onDragEnd={endCatDrag}
                    onDragOver={(e) => {
                      if (catSwapping) { e.preventDefault(); setOverCat(group.label); }
                      else if (dragHref) { e.preventDefault(); setOverCat(`into:${group.label}`); }
                    }}
                    onDrop={(e) => {
                      if (catSwapping) { e.preventDefault(); swapCat(group.label); }
                      else if (dragHref) { e.preventDefault(); dropBefore(group.label, null); setOverCat(null); }
                      else endCatDrag();
                    }}
                    className={`group/cat px-1 py-0.5 mb-1.5 flex items-center gap-0.5 rounded-md transition-all duration-150 ${
                      catDraggable ? "cursor-grab active:cursor-grabbing" : ""
                    } ${dragCat === group.label ? "opacity-40 ring-1 ring-primary/50" : ""} ${
                      catSwapping
                        ? (overCat === group.label ? "ring-2 ring-primary bg-primary/14" : "ring-1 ring-primary/40")
                        : catRowTarget
                          ? (rowIntoHover ? "ring-2 ring-success bg-success/12" : "ring-1 ring-success/40")
                          : ""
                    }`}
                  >
                    {isSub
                      ? <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                      : <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover/cat:text-muted-foreground transition-colors" />}
                    {group.custom && catEditing ? (
                      <input
                        autoFocus
                        value={catDraftLabel}
                        onChange={(e) => setCatDraftLabel(e.target.value)}
                        onBlur={() => commitEditCat(group.label)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitEditCat(group.label); else if (e.key === "Escape") setEditKey(null); }}
                        aria-label={`Nom de la catégorie ${group.label}`}
                        className="min-w-0 flex-1 h-6 rounded-md border-[length:var(--hairline)] border-border bg-secondary px-1.5 text-caption2 uppercase tracking-[0.1em] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    ) : (
                      <span className={`kicker min-w-0 flex-1 truncate ${isSub ? "tracking-[0.14em]" : ""}`}>
                        {group.label}
                      </span>
                    )}
                    {group.custom && (
                      <button type="button" draggable={false} onMouseDown={(e) => e.preventDefault()}
                        onClick={() => (catEditing ? commitEditCat(group.label) : startEditCat(group.label))}
                        title={catEditing ? "Valider le nom" : "Renommer la catégorie"}
                        className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                        {catEditing ? <Check className="h-3 w-3 text-success" /> : <Pencil className="h-3 w-3" />}
                      </button>
                    )}
                    <button type="button" onClick={() => shiftCategory(group.label, -1)} title="Monter la catégorie"
                      className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => shiftCategory(group.label, 1)} title="Descendre la catégorie"
                      className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {!isSub && (
                      <button type="button" onClick={() => addSubCategory(group.label)} title="Ajouter une sous-catégorie"
                        className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-muted-foreground/60 hover:text-primary hover:bg-secondary transition-colors">
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                    {group.custom && (
                      <button type="button" onClick={() => removeCategory(group.label)} disabled={!canDelete}
                        title={canDelete ? "Supprimer la catégorie" : "Videz la catégorie (et ses sous-catégories) pour la supprimer"}
                        className="h-6 w-5 shrink-0 rounded flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-secondary transition-colors disabled:opacity-25 disabled:hover:text-muted-foreground/60 disabled:hover:bg-transparent">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })()}
              <ul className="space-y-1">
                {group.rows.map((row) => {
                  // Icône d'origine — repli neutre si la route a disparu de la
                  // structure (surcharge orpheline : jamais bloquant).
                  const Icon = ICON_BY_HREF.get(row.href) ?? Circle;
                  const dragging = dragHref === row.href;
                  const rowEditing = editKey === `row:${row.href}`;
                  // Échange : au pick-up, toutes les autres entrées s'allument
                  // (simple) ; celle survolée s'allume plus fort.
                  const rowHovered = overKey === `row:${row.href}` && !!dragHref && !dragging;
                  const rowCandidate = !!dragHref && !dragging && !rowEditing;
                  return (
                    <li
                      key={row.href}
                      draggable={!rowEditing}
                      onDragStart={rowEditing ? undefined : (e) => { e.dataTransfer.effectAllowed = "move"; setDragHref(row.href); }}
                      onDragEnd={endDrag}
                      onDragOver={(e) => {
                        if (dragHref && !dragging) { e.preventDefault(); setOverKey(`row:${row.href}`); }
                      }}
                      onDrop={(e) => { e.preventDefault(); dropOnRow(row.href); }}
                      title={rowEditing ? undefined : "Glisser · déposer sur une autre entrée pour les échanger"}
                      className={`group/row flex items-center gap-1.5 rounded-lg pr-1 min-h-[38px] transition-all duration-150 ${
                        rowEditing ? "" : "cursor-grab active:cursor-grabbing"
                      } ${dragging ? "opacity-40 ring-1 ring-primary/50" : ""} ${
                        rowHovered ? "ring-2 ring-primary bg-primary/14"
                        : rowCandidate ? "ring-1 ring-primary/40" : "hover:bg-secondary"
                      }`}
                    >
                      {/* Poignée VISUELLE — toute la ligne glisse (« prendre toute la case »). */}
                      <span className="shrink-0 h-8 w-3.5 flex items-center justify-center text-muted-foreground/50 group-hover/row:text-muted-foreground transition-colors">
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
                      {rowEditing ? (
                        <input
                          autoFocus
                          value={row.label}
                          onChange={(e) => renameDraft(row.href, e.target.value)}
                          onBlur={() => setEditKey(null)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditKey(null); }}
                          placeholder={row.defaultLabel}
                          aria-label={`Libellé de ${row.defaultLabel}`}
                          className="min-w-0 flex-1 h-8 rounded-lg border-[length:var(--hairline)] border-border bg-secondary px-2 text-caption text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate py-1.5 text-caption text-foreground">
                          {row.label.trim() || row.defaultLabel}
                        </span>
                      )}
                      <button type="button" draggable={false} onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setEditKey(rowEditing ? null : `row:${row.href}`)}
                        title={rowEditing ? "Valider" : "Renommer"}
                        aria-label={`Renommer ${row.defaultLabel}`}
                        className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                        {rowEditing ? <Check className="h-3 w-3 text-success" /> : <Pencil className="h-3 w-3" />}
                      </button>
                    </li>
                  );
                })}
                {group.rows.length === 0 && (
                  <li className={`px-2 py-1 text-caption2 italic transition-colors ${dragHref ? "text-primary" : "text-muted-foreground/70"}`}>
                    {dragHref ? "Dépose sur l'en-tête pour ajouter ici." : "Zone vide — glisse une entrée sur l'en-tête de cette catégorie."}
                  </li>
                )}
              </ul>
            </div>
          );
        })}
        {/* ＋ Créer une catégorie de 1er niveau — sert AUSSI de zone de dépôt
            « fin de liste » quand on glisse une catégorie. */}
        <button
          type="button"
          onClick={addCategory}
          onDragOver={(e) => { if (dragCat) { e.preventDefault(); setOverCat("__end__"); } }}
          onDrop={(e) => { if (dragCat) { e.preventDefault(); dropCatBefore(null); } }}
          title="Créer une nouvelle catégorie"
          className={`w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed text-caption font-semibold transition-colors ${
            overCat === "__end__" && dragCat
              ? "border-primary bg-primary/14 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground hover:border-primary/60 hover:bg-secondary"
          }`}
        >
          <FolderPlus className="h-3.5 w-3.5" /> Nouvelle catégorie
        </button>
      </div>

      {/* ── Actions : Enregistrer / Annuler / Réinitialiser ── */}
      <div className="shrink-0 border-t-[length:var(--hairline)] border-border px-3 py-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => save(fromNavEditState(draft), "Navigation enregistrée")}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-caption font-semibold disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
          Enregistrer
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="inline-flex items-center justify-center h-9 px-2.5 rounded-lg border-[length:var(--hairline)] border-border text-caption font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => save({ items: {}, categories: [] }, "Navigation réinitialisée (libellés et zones d'origine)")}
          disabled={saving}
          title="Revenir aux libellés et emplacements d'origine"
          className="inline-flex items-center justify-center h-9 w-9 rounded-lg border-[length:var(--hairline)] border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
