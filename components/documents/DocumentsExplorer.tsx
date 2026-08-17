"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2, FileText, Filter, Inbox, Workflow, ArrowDown } from "lucide-react";
import { DocumentActions } from "@/components/documents/DocumentActions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate, formatRelative } from "@/lib/utils";

interface Doc {
  id: string;
  docType: string;
  docNum: string | null;
  docEntry: number | null;
  fileName: string;
  clientId: string | null;
  clientNom: string | null;
  cardCode: string | null;
  docDate: string | null;
  receivedAt: string;
  lastSentAt: string | null;
  lastSentTo: string | null;
  matched: boolean;
  sizeBytes: number;
}

interface ChainNode {
  docEntry: number;
  docNum: string | number | null;
  archived: { id: string; fileName: string; lastSentAt: string | null } | null;
}
interface Chain { bl: ChainNode | null; facture: ChainNode | null; avoirs: ChainNode[]; }

const TYPES = [
  { key: "", label: "Tous" },
  { key: "FACTURE", label: "Factures" },
  { key: "BL", label: "BL" },
  { key: "AVOIR", label: "Avoirs" },
] as const;

const TYPE_PILL: Record<string, string> = {
  FACTURE: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  BL: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  AVOIR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  AUTRE: "bg-secondary text-muted-foreground",
};
const TYPE_LABEL: Record<string, string> = { FACTURE: "Facture", BL: "BL", AVOIR: "Avoir", AUTRE: "Doc" };
const PAGE = 40;

export function DocumentsExplorer() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const reqId = useRef(0);

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

  const load = useCallback(async (opts: { page: number; append: boolean }) => {
    const my = ++reqId.current;
    if (opts.append) setLoadingMore(true); else setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(opts.page), limit: String(PAGE) });
      if (q.trim()) p.set("q", q.trim());
      if (type) p.set("type", type);
      const j = await fetch(`/api/archive/list?${p}`, { cache: "no-store" }).then((r) => r.json());
      if (my !== reqId.current) return;
      const rows: Doc[] = j.docs ?? [];
      setDocs((cur) => (opts.append ? [...cur, ...rows] : rows));
      setTotal(j.total ?? rows.length);
      setPage(opts.page);
    } catch {
      if (my === reqId.current && !opts.append) setDocs([]);
    } finally {
      if (my === reqId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [q, type]);

  useEffect(() => {
    const t = setTimeout(() => load({ page: 1, append: false }), 220);
    return () => clearTimeout(t);
  }, [load]);

  const shown = docs.length;
  const hasMore = shown < total;

  return (
    <div className="space-y-4">
      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher : n° de document, client, code, fichier…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={type === t.key}
              onClick={() => setType(t.key)}
              className={`px-3 h-9 rounded-md text-[12.5px] font-medium transition-colors ${
                type === t.key ? "bg-brand-500 text-on-accent shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {!loading && <span className="text-[12px] text-muted-foreground tnum">{total} document{total > 1 ? "s" : ""}</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-[14px] font-medium text-foreground">Aucun document</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {q || type ? "Ajustez la recherche ou le filtre." : "Les PDF récupérés de la boîte d'archive apparaîtront ici."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 text-left font-semibold">Type</th>
                  <th className="px-3 py-2.5 text-left font-semibold">N°</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Client</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Date</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Envoyé</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {docs.map((d) => (
                  <tr key={d.id} className="transition-colors hover:bg-secondary/30">
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${TYPE_PILL[d.docType] ?? TYPE_PILL.AUTRE}`}>
                        {TYPE_LABEL[d.docType] ?? d.docType}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12.5px] font-semibold text-foreground">{d.docNum ?? "—"}</td>
                    <td className="px-3 py-2 max-w-[220px]">
                      {d.clientNom ? (
                        <span className="truncate block text-foreground" title={d.clientNom}>{d.clientNom}</span>
                      ) : (
                        <span className="text-muted-foreground/60 italic" title={d.cardCode ?? undefined}>non rattaché{d.cardCode ? ` · ${d.cardCode}` : ""}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tnum whitespace-nowrap">
                      {d.docDate ? formatDate(d.docDate).slice(0, 10) : formatRelative(d.receivedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {d.lastSentAt ? (
                        <span className="text-[11.5px] text-emerald-700 dark:text-emerald-400" title={`Envoyé à ${d.lastSentTo ?? "?"}`}>
                          ✓ {formatDate(d.lastSentAt).slice(0, 10)}
                        </span>
                      ) : (
                        <span className="text-[11.5px] text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openChain(d.id)}
                          title="Dossier lié — BL → Facture → Avoir"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        >
                          <Workflow className="h-3.5 w-3.5" />
                        </button>
                        <DocumentActions
                          docType={d.docType}
                          docNum={d.docNum}
                          preloaded={{ id: d.id, fileName: d.fileName, lastSentAt: d.lastSentAt }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => load({ page: page + 1, append: true })}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-border bg-card text-[12.5px] font-medium text-foreground hover:bg-secondary/60 disabled:opacity-60"
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
            Charger plus ({shown}/{total})
          </button>
        </div>
      )}

      {/* ── Dossier lié : BL → Facture → Avoir ── */}
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
                          <DocumentActions
                            docType={it.type}
                            docNum={it.node.docNum}
                            preloaded={{ id: it.node.archived.id, fileName: it.node.archived.fileName, lastSentAt: it.node.archived.lastSentAt }}
                          />
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
    </div>
  );
}
