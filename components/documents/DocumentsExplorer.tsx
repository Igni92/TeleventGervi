"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, Workflow, ArrowDown, Folder, FolderOpen, ChevronLeft, Inbox, Eye, CheckCircle2, ArrowDownAZ, CalendarClock } from "lucide-react";
import { DocumentActions } from "@/components/documents/DocumentActions";
import { PdfPreviewDialog } from "@/components/documents/PdfPreviewDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

const TYPE_PILL: Record<string, string> = {
  FACTURE: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  BL: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  AVOIR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  AUTRE: "bg-secondary text-muted-foreground",
};
const TYPE_LABEL: Record<string, string> = { FACTURE: "Facture", BL: "BL", AVOIR: "Avoir", AUTRE: "Doc" };
const TYPE_ORDER = ["BL", "FACTURE", "AVOIR", "AUTRE"];

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

    // Cellule d'un maillon (BL/Facture/Avoir) — vide si absent.
    const cell = (type: string, doc: Doc | undefined, extra?: number) => {
      if (!doc) {
        return (
          <div className="rounded-xl border border-dashed border-border/50 p-2.5 flex flex-col items-center justify-center text-center min-h-[62px]">
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider opacity-40 ${TYPE_PILL[type]}`}>{TYPE_LABEL[type]}</span>
            <span className="text-[11px] text-muted-foreground/40 mt-1">—</span>
          </div>
        );
      }
      return (
        <div
          onClick={() => setPreview({ id: doc.id, fileName: doc.fileName })}
          className="group/cell rounded-xl border border-border bg-background/40 p-2.5 cursor-pointer hover:border-brand-400/50 hover:bg-secondary/30 transition-colors min-h-[62px]"
          title="Aperçu du document"
        >
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider ${TYPE_PILL[type]}`}>{TYPE_LABEL[type]}</span>
            <span className="font-mono text-[12px] font-semibold text-foreground truncate">{doc.docNum ?? "—"}</span>
            {extra ? <span className="text-[10px] text-muted-foreground">+{extra}</span> : null}
            <Eye className="ml-auto h-3.5 w-3.5 text-muted-foreground/40 group-hover/cell:text-brand-500 transition-colors shrink-0" />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="tnum" title="Date du document">{doc.docDate ? formatDate(doc.docDate).slice(0, 10) : "—"}</span>
            {/* Date d'ENVOI au client = date du mail archivé (la copie archivée EST
                l'envoi au client), ou date de renvoi depuis l'app si re-envoyé. */}
            <span
              className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"
              title={`Envoyé au client le ${formatDate(doc.lastSentAt ?? doc.receivedAt)}${doc.lastSentAt ? " (renvoyé depuis l'app)" : " (copie archivée = envoi au client)"}`}
            >
              <CheckCircle2 className="h-2.5 w-2.5" /> env. {formatDate(doc.lastSentAt ?? doc.receivedAt).slice(0, 10)}
            </span>
            <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
              <DocumentActions compact hidePdf docType={type} docNum={doc.docNum} preloaded={{ id: doc.id, fileName: doc.fileName, lastSentAt: doc.lastSentAt }} />
            </span>
          </div>
        </div>
      );
    };
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setOpen(null)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-[12.5px] font-medium hover:bg-secondary/60 transition-colors">
            <ChevronLeft className="h-4 w-4" /> Dossiers
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-9 w-9 rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0"><FolderOpen className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="font-semibold text-[15px] text-foreground truncate leading-tight">{open.nom}</p>
              {open.code && <p className="font-mono text-[11px] text-muted-foreground">{open.code}</p>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5" title="Trier les dossiers">
              <button type="button" onClick={() => setSort("date")} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-[12px] font-medium transition-colors ${sort === "date" ? "bg-brand-500 text-on-accent shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <CalendarClock className="h-3.5 w-3.5" /> Date
              </button>
              <button type="button" onClick={() => setSort("num")} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-[12px] font-medium transition-colors ${sort === "num" ? "bg-brand-500 text-on-accent shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <ArrowDownAZ className="h-3.5 w-3.5" /> N°
              </button>
            </div>
            <span className="text-[12px] text-muted-foreground tnum whitespace-nowrap">{dossiers.length} dossier{dossiers.length > 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* En-tête de colonnes du dossier */}
        {dossiers.length > 0 && (
          <div className="hidden sm:grid grid-cols-3 gap-2.5 px-2.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
            <span>Bon de livraison</span><span>Facture</span><span>Avoir</span>
          </div>
        )}

        {docsLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : dossiers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 py-14 text-center text-[13px] text-muted-foreground">Aucun document.</div>
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

  // ── Vue racine : grille de dossiers clients ──
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un client (nom ou code) ou un n° de document…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </div>
        {availableTypes.length > 0 && (
          <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5">
            <button type="button" onClick={() => setClientType("")} className={`px-2.5 h-8 rounded-md text-[12px] font-medium transition-colors ${clientType === "" ? "bg-brand-500 text-on-accent shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Tous</button>
            {availableTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setClientType(t)}
                className={`px-2.5 h-8 rounded-md text-[12px] font-medium transition-colors ${clientType === t ? "bg-brand-500 text-on-accent shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {clientTypeLabel(t)}
              </button>
            ))}
          </div>
        )}
        {folders && <span className="text-[12px] text-muted-foreground tnum whitespace-nowrap">{folders.length} client{folders.length > 1 ? "s" : ""} · {totalDocs} doc{totalDocs > 1 ? "s" : ""}</span>}
      </div>

      {folders === null ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : folders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-[14px] font-medium text-foreground">Aucun dossier</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{q ? "Aucun client ne correspond." : "Les documents archivés apparaîtront ici, rangés par client."}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {folders.map((f) => {
            const isNone = f.clientId === null;
            return (
              <li key={f.clientId ?? "__none__"}>
                <button
                  type="button"
                  onClick={() => setOpen({ clientId: f.clientId, nom: f.clientNom ?? "Non rattachés", code: f.cardCode })}
                  className="group w-full text-left rounded-2xl border border-border bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-card-hover hover:border-brand-400/50"
                >
                  <div className="flex items-start gap-3">
                    <span className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${isNone ? "bg-secondary text-muted-foreground" : "bg-brand-500/12 text-brand-600 dark:text-brand-400"}`}>
                      <Folder className="h-5 w-5 group-hover:hidden" />
                      <FolderOpen className="h-5 w-5 hidden group-hover:block" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className={`font-semibold text-[14px] truncate leading-tight ${isNone ? "text-muted-foreground italic" : "text-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400"}`}>
                          {f.clientNom ?? "Non rattachés"}
                        </p>
                        {f.clientType && (
                          <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-secondary text-muted-foreground">{clientTypeLabel(f.clientType)}</span>
                        )}
                      </div>
                      {f.cardCode && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{f.cardCode}</p>}
                    </div>
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-full bg-secondary text-[11.5px] font-bold text-foreground tnum">{f.total}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {TYPE_ORDER.filter((t) => (f.byType[t] ?? 0) > 0).map((t) => (
                      <span key={t} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${TYPE_PILL[t]}`}>
                        {TYPE_LABEL[t]} <span className="tnum">{f.byType[t]}</span>
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
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
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Résolution du dossier…</div>
          ) : chainErr ? (
            <p className="py-4 text-[13px] text-muted-foreground">Chaînage indisponible : {chainErr}</p>
          ) : chain ? (
            <div className="space-y-0">
              {(() => {
                const items: { type: string; label: string; node: ChainNode }[] = [];
                if (chain.bl) items.push({ type: "BL", label: "Bon de livraison", node: chain.bl });
                if (chain.facture) items.push({ type: "FACTURE", label: "Facture", node: chain.facture });
                for (const a of chain.avoirs) items.push({ type: "AVOIR", label: "Avoir", node: a });
                if (items.length === 0) return <p className="py-4 text-[13px] text-muted-foreground">Aucun document lié trouvé.</p>;
                return items.map((it, i) => (
                  <div key={`${it.type}-${it.node.docEntry}`}>
                    {i > 0 && <div className="flex justify-center py-1"><ArrowDown className="h-4 w-4 text-muted-foreground/40" /></div>}
                    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${chainCurrent === it.type ? "border-brand-400 bg-brand-500/10" : "border-border bg-card"}`}>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${TYPE_PILL[it.type]}`}>{it.label}</span>
                      <span className="font-mono text-[12.5px] font-semibold text-foreground">{it.node.docNum ?? "—"}</span>
                      <span className="ml-auto">
                        {it.node.archived ? (
                          <DocumentActions docType={it.type} docNum={it.node.docNum} preloaded={{ id: it.node.archived.id, fileName: it.node.archived.fileName, lastSentAt: it.node.archived.lastSentAt }} />
                        ) : (
                          <span className="text-[11px] italic text-muted-foreground/50">non archivé</span>
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
