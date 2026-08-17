"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, Workflow, ArrowDown, Folder, FolderOpen, ChevronLeft, Inbox, FileText, Truck, ReceiptText } from "lucide-react";
import { DocumentActions } from "@/components/documents/DocumentActions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate, formatRelative } from "@/lib/utils";

interface FolderRow {
  clientId: string | null;
  clientNom: string | null;
  cardCode: string | null;
  total: number;
  byType: Record<string, number>;
  lastReceivedAt: string | null;
}
interface Doc {
  id: string; docType: string; docNum: string | null; docEntry: number | null;
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
const TYPE_ICON: Record<string, typeof FileText> = { FACTURE: ReceiptText, BL: Truck, AVOIR: FileText, AUTRE: FileText };
const TYPE_ORDER = ["BL", "FACTURE", "AVOIR", "AUTRE"];

export function DocumentsExplorer() {
  // Vue « dossiers » (clients) ou « ouvert » (documents d'un client).
  const [open, setOpen] = useState<{ clientId: string | null; nom: string; code: string | null } | null>(null);

  const [q, setQ] = useState("");
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [totalDocs, setTotalDocs] = useState(0);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [typeF, setTypeF] = useState("");

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
      const j = await fetch(`/api/archive/folders?${p}`, { cache: "no-store" }).then((r) => r.json());
      setFolders(j.folders ?? []);
      setTotalDocs(j.totalDocs ?? 0);
    } catch { setFolders([]); }
  }, [q]);

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
    const visible = typeF ? docs.filter((d) => d.docType === typeF) : docs;
    const groups = TYPE_ORDER.map((t) => ({ type: t, items: visible.filter((d) => d.docType === t) })).filter((g) => g.items.length > 0);
    const typesPresent = TYPE_ORDER.filter((t) => docs.some((d) => d.docType === t));
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
          {typesPresent.length > 1 && (
            <div className="ml-auto inline-flex rounded-lg border border-border bg-card p-0.5">
              <button type="button" onClick={() => setTypeF("")} className={`px-3 h-8 rounded-md text-[12px] font-medium transition-colors ${typeF === "" ? "bg-brand-500 text-on-accent shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Tous</button>
              {typesPresent.map((t) => (
                <button key={t} type="button" onClick={() => setTypeF(t)} className={`px-3 h-8 rounded-md text-[12px] font-medium transition-colors ${typeF === t ? "bg-brand-500 text-on-accent shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {TYPE_LABEL[t]}s
                </button>
              ))}
            </div>
          )}
        </div>

        {docsLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 py-14 text-center text-[13px] text-muted-foreground">Aucun document.</div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => {
              const Icon = TYPE_ICON[g.type] ?? FileText;
              return (
                <section key={g.type} className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
                  <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-secondary/30">
                    <span className={`h-6 w-6 rounded-md flex items-center justify-center ${TYPE_PILL[g.type]}`}><Icon className="h-3.5 w-3.5" /></span>
                    <h3 className="text-[13px] font-semibold text-foreground">{TYPE_LABEL[g.type]}s</h3>
                    <span className="text-[11.5px] text-muted-foreground tnum">{g.items.length}</span>
                  </header>
                  <ul className="divide-y divide-border/60">
                    {g.items.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 px-4 py-2 hover:bg-secondary/25 transition-colors">
                        <span className="font-mono text-[12.5px] font-semibold text-foreground shrink-0 w-24 truncate">{d.docNum ?? "—"}</span>
                        <span className="text-[12px] text-muted-foreground tnum whitespace-nowrap shrink-0">{d.docDate ? formatDate(d.docDate).slice(0, 10) : formatRelative(d.receivedAt)}</span>
                        {d.lastSentAt ? (
                          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0" title={`Envoyé à ${d.lastSentTo ?? "?"}`}>✓ envoyé</span>
                        ) : <span className="w-0" />}
                        <span className="flex-1" />
                        <button type="button" onClick={() => openChain(d.id)} title="Dossier lié — BL → Facture → Avoir" className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0">
                          <Workflow className="h-3.5 w-3.5" />
                        </button>
                        <DocumentActions docType={d.docType} docNum={d.docNum} preloaded={{ id: d.id, fileName: d.fileName, lastSentAt: d.lastSentAt }} className="shrink-0" />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {chainDialog()}
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
            placeholder="Rechercher un client (nom ou code)…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </div>
        {folders && <span className="text-[12px] text-muted-foreground tnum">{folders.length} dossier{folders.length > 1 ? "s" : ""} · {totalDocs} document{totalDocs > 1 ? "s" : ""}</span>}
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
                      <p className={`font-semibold text-[14px] truncate leading-tight ${isNone ? "text-muted-foreground italic" : "text-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400"}`}>
                        {f.clientNom ?? "Non rattachés"}
                      </p>
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
