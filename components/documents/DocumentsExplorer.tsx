"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Search, Loader2, Workflow, ArrowDown, FolderOpen, ChevronLeft, Inbox,
  Eye, CheckCircle2, ArrowDownAZ, CalendarClock,
} from "lucide-react";
import { DocumentActions } from "@/components/documents/DocumentActions";
import { DocumentsKanban } from "@/components/documents/DocumentsKanban";
import { PdfPreviewDialog } from "@/components/documents/PdfPreviewDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { GroupedList, GroupedRow } from "@/components/ui/grouped-list";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DOC_TYPE_PILL, DOC_TYPE_LABEL, DOC_TYPE_ORDER } from "@/components/documents/doc-types";
import { formatDate } from "@/lib/utils";

interface FolderRow {
  clientId: string | null;
  clientNom: string | null;
  cardCode: string | null;
  clientType: string | null;
  total: number;
  byType: Record<string, number>;
  lastReceivedAt: string | null;
}

/** Libellés lisibles des types clients (le reste est capitalisé automatiquement). */
const CLIENT_TYPE_LABEL: Record<string, string> = {
  GMS: "GMS", CHR: "CHR", EXPORT: "Export", MARCHE: "Marché", GROSSISTE: "Grossiste",
};
const clientTypeLabel = (t: string) => CLIENT_TYPE_LABEL[t] ?? (t.charAt(0) + t.slice(1).toLowerCase());

interface Doc {
  id: string; docType: string; docNum: string | null; docEntry: number | null; invoiceEntry: number | null;
  fileName: string; clientNom: string | null; cardCode: string | null;
  docDate: string | null; receivedAt: string; lastSentAt: string | null; lastSentTo: string | null;
  matched: boolean; sizeBytes: number;
}
interface ChainNode { docEntry: number; docNum: string | number | null; archived: { id: string; fileName: string; lastSentAt: string | null } | null; }
interface Chain { bl: ChainNode | null; facture: ChainNode | null; avoirs: ChainNode[]; }

export function DocumentsExplorer() {
  // Vue « dossiers » (clients) ou « ouvert » (documents d'un client).
  const [open, setOpen] = useState<{ clientId: string | null; nom: string; code: string | null } | null>(null);

  const [q, setQ] = useState("");
  const [clientType, setClientType] = useState("");
  const [sort, setSort] = useState<"date" | "num">("date");
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [clientView, setClientView] = useState<"dossiers" | "kanban">("dossiers");
  const [preview, setPreview] = useState<{ id: string; fileName: string } | null>(null);

  // Dossier lié (BL → Facture → Avoir)
  const [chainOpen, setChainOpen] = useState(false);
  const [chain, setChain] = useState<Chain | null>(null);
  const [chainCurrent, setChainCurrent] = useState("");
  const [chainLoading, setChainLoading] = useState(false);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const openChain = useCallback(async (docId: string) => {
    setChainOpen(true); setChainLoading(true); setChain(null); setChainErr(null);
    try {
      const j = await fetch(`/api/archive/${docId}/chain`, { cache: "no-store" }).then((r) => r.json());
      if (j.chain) { setChain(j.chain); setChainCurrent(j.current ?? ""); }
      else setChainErr(j.reason || "Chaînage indisponible");
    } catch { setChainErr("Erreur réseau"); }
    finally { setChainLoading(false); }
  }, []);

  // Charge les dossiers (vue racine).
  const loadFolders = useCallback(async () => {
    setFolders(null);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (clientType) p.set("clientType", clientType);
      const j = await fetch(`/api/archive/folders?${p}`, { cache: "no-store" }).then((r) => r.json());
      setFolders(j.folders ?? []);
      if (Array.isArray(j.availableTypes) && j.availableTypes.length) setAvailableTypes(j.availableTypes);
      setTotalDocs(j.totalDocs ?? 0);
    } catch { setFolders([]); }
  }, [q, clientType]);

  // Charge les documents d'un dossier client.
  const loadDocs = useCallback(async (folder: { clientId: string | null }) => {
    setDocsLoading(true);
    try {
      const p = new URLSearchParams({ limit: "200" });
      if (folder.clientId) p.set("clientId", folder.clientId); else p.set("noClient", "1");
      const j = await fetch(`/api/archive/list?${p}`, { cache: "no-store" }).then((r) => r.json());
      setDocs(j.docs ?? []);
    } catch { setDocs([]); }
    finally { setDocsLoading(false); }
  }, []);

  useEffect(() => { if (open) return; const t = setTimeout(loadFolders, 220); return () => clearTimeout(t); }, [open, loadFolders]);
  useEffect(() => { if (open) loadDocs(open); }, [open, loadDocs]);

  // ── Vue documents d'un client ──
  if (open) {
    // Regroupe par DOSSIER (invoiceEntry = facture pivot) : chaque dossier montre
    // BL | Facture | Avoir CÔTE À CÔTE. Les documents pas encore chaînés
    // (invoiceEntry null) forment un dossier « solo » jusqu'à ce que le cron de
    // chaînage les relie.
    const dmap = new Map<string, { key: string; bl?: Doc; facture?: Doc; avoirs: Doc[]; sortKey: string }>();
    for (const d of docs) {
      const key = d.invoiceEntry != null ? `inv-${d.invoiceEntry}` : `solo-${d.id}`;
      const g = dmap.get(key) ?? { key, avoirs: [], sortKey: "" };
      if (d.docType === "FACTURE") g.facture = d;
      else if (d.docType === "BL") g.bl = d;
      else g.avoirs.push(d); // AVOIR (+ AUTRE éventuel)
      const dt = d.docDate ?? d.receivedAt;
      if (dt > g.sortKey) g.sortKey = dt;
      dmap.set(key, g);
    }
    const dossierNum = (g: { facture?: Doc; bl?: Doc; avoirs: Doc[] }) => {
      const n = g.facture?.docNum ?? g.bl?.docNum ?? g.avoirs[0]?.docNum ?? null;
      return n != null ? (parseInt(String(n), 10) || 0) : -1;
    };
    const dossiers = [...dmap.values()].sort((a, b) =>
      sort === "num" ? dossierNum(b) - dossierNum(a) : b.sortKey.localeCompare(a.sortKey),
    );

    // Cellule d'un maillon (BL/Facture/Avoir) — vide si absent. L'APERÇU (zone
    // n°/date, cliquable) et les ACTIONS (rangée d'icônes) sont dissociés.
    const cell = (type: string, doc: Doc | undefined, extra?: number) => {
      if (!doc) {
        return (
          <div className="rounded-xl border border-dashed border-border/50 p-2.5 flex flex-col items-center justify-center text-center min-h-[76px]">
            <span className={`inline-flex px-1.5 py-0.5 rounded text-caption2 font-bold uppercase tracking-wider opacity-40 ${DOC_TYPE_PILL[type]}`}>{DOC_TYPE_LABEL[type]}</span>
            <span className="text-caption text-muted-foreground/40 mt-1">—</span>
          </div>
        );
      }
      return (
        <div className="rounded-xl border border-border bg-card overflow-hidden min-h-[76px] flex flex-col">
          {/* Aperçu : n° + date, cliquable pour ouvrir le PDF */}
          <button
            type="button"
            onClick={() => setPreview({ id: doc.id, fileName: doc.fileName })}
            title="Aperçu du document"
            className="group/cell flex-1 text-left px-2.5 pt-2.5 pb-1.5 hover:bg-secondary/40 transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-caption2 font-bold uppercase tracking-wider ${DOC_TYPE_PILL[type]}`}>{DOC_TYPE_LABEL[type]}</span>
              <span className="font-mono text-caption font-semibold text-foreground truncate">{doc.docNum ?? "—"}</span>
              {extra ? <span className="text-caption2 text-muted-foreground">+{extra}</span> : null}
              <Eye className="ml-auto h-3.5 w-3.5 text-muted-foreground/40 group-hover/cell:text-brand-500 transition-colors shrink-0" />
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-caption2 text-muted-foreground">
              <span className="tnum" title="Date du document">{doc.docDate ? formatDate(doc.docDate).slice(0, 10) : "—"}</span>
              {/* Date d'ENVOI au client = date du mail archivé (la copie archivée EST
                  l'envoi au client), ou date de renvoi depuis l'app si re-envoyé. */}
              <span
                className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"
                title={`Envoyé au client le ${formatDate(doc.lastSentAt ?? doc.receivedAt)}${doc.lastSentAt ? " (renvoyé depuis l'app)" : " (copie archivée = envoi au client)"}`}
              >
                <CheckCircle2 className="h-2.5 w-2.5" /> env. {formatDate(doc.lastSentAt ?? doc.receivedAt).slice(0, 10)}
              </span>
            </div>
          </button>
          {/* Actions : rangée d'icônes, séparée de l'aperçu */}
          <div className="flex items-center justify-end gap-1.5 border-t border-border/60 bg-secondary/20 px-2 py-1">
            <DocumentActions compact hidePdf docType={type} docNum={doc.docNum} preloaded={{ id: doc.id, fileName: doc.fileName, lastSentAt: doc.lastSentAt }} />
          </div>
        </div>
      );
    };
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setOpen(null)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-caption font-medium hover:bg-secondary/60 transition-colors">
            <ChevronLeft className="h-4 w-4" /> Dossiers
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-9 w-9 rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0"><FolderOpen className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="font-semibold text-callout text-foreground truncate leading-tight">{open.nom}</p>
              {open.code && <p className="font-mono text-caption2 text-muted-foreground">{open.code}</p>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <SegmentedControl
              size="sm"
              aria-label="Affichage des documents"
              value={clientView}
              onChange={setClientView}
              options={[
                { value: "dossiers", label: "Dossiers" },
                { value: "kanban", label: "Kanban" },
              ]}
            />
            {clientView === "dossiers" && (
              <SegmentedControl
                size="sm"
                aria-label="Trier les dossiers"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "date", label: "Date", icon: <CalendarClock className="h-3.5 w-3.5" /> },
                  { value: "num", label: "N°", icon: <ArrowDownAZ className="h-3.5 w-3.5" /> },
                ]}
              />
            )}
            <span className="text-caption text-muted-foreground tnum whitespace-nowrap">{dossiers.length} dossier{dossiers.length > 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* En-tête de colonnes du dossier */}
        {clientView === "dossiers" && dossiers.length > 0 && (
          <div className="hidden sm:grid grid-cols-3 gap-2.5 px-2.5 text-caption2 uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
            <span>Bon de livraison</span><span>Facture</span><span>Avoir</span>
          </div>
        )}

        {docsLoading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <Skeleton className="h-[76px] rounded-xl" />
                <Skeleton className="h-[76px] rounded-xl" />
                <Skeleton className="h-[76px] rounded-xl" />
              </div>
            ))}
          </div>
        ) : clientView === "kanban" ? (
          <DocumentsKanban docs={docs} onChanged={() => { if (open) loadDocs(open); }} />
        ) : dossiers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50">
            <EmptyState icon={Inbox} title="Aucun document" description="Ce dossier client ne contient encore aucun document archivé." />
          </div>
        ) : (
          <div className="space-y-2.5">
            {dossiers.map((g) => (
              <div key={g.key} className="rounded-2xl border border-border bg-card shadow-card p-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {cell("BL", g.bl)}
                {cell("FACTURE", g.facture)}
                {cell("AVOIR", g.avoirs[0], g.avoirs.length > 1 ? g.avoirs.length - 1 : undefined)}
              </div>
            ))}
          </div>
        )}
        {chainDialog()}
        <PdfPreviewDialog docId={preview?.id ?? null} fileName={preview?.fileName} open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }} />
      </div>
    );
  }

  // ── Vue racine : liste groupée de dossiers clients ──
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un client (nom ou code) ou un n° de document…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-body focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </div>
        {availableTypes.length > 0 && (
          <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5">
            <button type="button" onClick={() => setClientType("")} className={`px-2.5 h-8 rounded-md text-caption font-medium transition-colors ${clientType === "" ? "bg-brand-500 text-on-accent" : "text-muted-foreground hover:text-foreground"}`}>Tous</button>
            {availableTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setClientType(t)}
                className={`px-2.5 h-8 rounded-md text-caption font-medium transition-colors ${clientType === t ? "bg-brand-500 text-on-accent" : "text-muted-foreground hover:text-foreground"}`}
              >
                {clientTypeLabel(t)}
              </button>
            ))}
          </div>
        )}
        {folders && <span className="text-caption text-muted-foreground tnum whitespace-nowrap">{folders.length} client{folders.length > 1 ? "s" : ""} · {totalDocs} doc{totalDocs > 1 ? "s" : ""}</span>}
      </div>

      {folders === null ? (
        <GroupedList zebra>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2 min-h-11">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-40 rounded" />
                <Skeleton className="mt-1.5 h-3 w-24 rounded" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          ))}
        </GroupedList>
      ) : folders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState
            icon={Inbox}
            title="Aucun dossier"
            description={q ? "Aucun client ne correspond à votre recherche." : "Les documents archivés apparaîtront ici, rangés par client."}
          />
        </div>
      ) : (
        <GroupedList zebra>
          {folders.map((f) => {
            const isNone = f.clientId === null;
            const nom = f.clientNom ?? "Non rattachés";
            return (
              <GroupedRow
                key={f.clientId ?? "__none__"}
                onClick={() => setOpen({ clientId: f.clientId, nom, code: f.cardCode })}
                label={<span className={isNone ? "italic text-muted-foreground" : undefined}>{nom}</span>}
                sublabel={f.cardCode ? <span className="font-mono">{f.cardCode}</span> : undefined}
              >
                {/* Chips compteurs à droite : un compteur par type présent, puis total. */}
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  {f.clientType && (
                    <span className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-caption2 font-bold uppercase tracking-wider bg-secondary text-muted-foreground">
                      {clientTypeLabel(f.clientType)}
                    </span>
                  )}
                  {DOC_TYPE_ORDER.filter((t) => (f.byType[t] ?? 0) > 0).map((t) => (
                    <span key={t} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-caption2 font-semibold ${DOC_TYPE_PILL[t]}`}>
                      {DOC_TYPE_LABEL[t]} <span className="tnum">{f.byType[t]}</span>
                    </span>
                  ))}
                  <span className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-full bg-secondary text-caption font-bold text-foreground tnum">{f.total}</span>
                </div>
              </GroupedRow>
            );
          })}
        </GroupedList>
      )}
      {chainDialog()}
    </div>
  );

  // ── Fenêtre « Dossier lié » (partagée entre les deux vues) ──
  function chainDialog() {
    return (
      <Dialog open={chainOpen} onOpenChange={(o) => { if (!o) setChainOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Workflow className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              Dossier du document
            </DialogTitle>
            <DialogDescription className="sr-only">Documents liés : bon de livraison, facture et avoir.</DialogDescription>
          </DialogHeader>
          {chainLoading ? (
            <div className="flex items-center gap-2 py-6 text-body text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Résolution du dossier…</div>
          ) : chainErr ? (
            <p className="py-4 text-body text-muted-foreground">Chaînage indisponible : {chainErr}</p>
          ) : chain ? (
            <div className="space-y-0">
              {(() => {
                const items: { type: string; label: string; node: ChainNode }[] = [];
                if (chain.bl) items.push({ type: "BL", label: "Bon de livraison", node: chain.bl });
                if (chain.facture) items.push({ type: "FACTURE", label: "Facture", node: chain.facture });
                for (const a of chain.avoirs) items.push({ type: "AVOIR", label: "Avoir", node: a });
                if (items.length === 0) return <p className="py-4 text-body text-muted-foreground">Aucun document lié trouvé.</p>;
                return items.map((it, i) => (
                  <div key={`${it.type}-${it.node.docEntry}`}>
                    {i > 0 && <div className="flex justify-center py-1"><ArrowDown className="h-4 w-4 text-muted-foreground/40" /></div>}
                    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${chainCurrent === it.type ? "border-brand-400 bg-brand-500/10" : "border-border bg-card"}`}>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-caption2 font-bold uppercase tracking-wider ${DOC_TYPE_PILL[it.type]}`}>{it.label}</span>
                      <span className="font-mono text-caption font-semibold text-foreground">{it.node.docNum ?? "—"}</span>
                      <span className="ml-auto">
                        {it.node.archived ? (
                          <DocumentActions docType={it.type} docNum={it.node.docNum} preloaded={{ id: it.node.archived.id, fileName: it.node.archived.fileName, lastSentAt: it.node.archived.lastSentAt }} />
                        ) : (
                          <span className="text-caption2 italic text-muted-foreground/50">non archivé</span>
                        )}
                      </span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    );
  }
}
