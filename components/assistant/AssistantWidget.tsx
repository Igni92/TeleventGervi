"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles, X, Send, Loader2, ArrowRight, ChevronDown } from "lucide-react";

type Model = { id: string; label: string; tier: string; note: string };
type Nav = { path: string; label: string };
type Msg = { role: "user" | "assistant"; content: string; nav?: Nav[] };

const LS_MODEL = "gervi:assistant:model";

/** Bulle d'aide IA — flottante en bas à droite. Conseille l'utilisateur sur
 *  l'usage du logiciel et peut ouvrir un écran (navigate). Le modèle est
 *  choisissable dès qu'une clé API est configurée. */
export function AssistantWidget() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/assistant", { cache: "no-store" });
        const j = await r.json();
        if (j?.enabled && Array.isArray(j.models)) {
          setEnabled(true);
          setModels(j.models);
          const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LS_MODEL) : null;
          setModel(saved && j.models.some((m: Model) => m.id === saved) ? saved : j.defaultModel);
        }
      } catch { /* assistant simplement absent */ }
    })();
  }, []);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);
  const pickModel = (id: string) => { setModel(id); setModelMenu(false); try { localStorage.setItem(LS_MODEL, id); } catch { /* */ } };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    // Message assistant en construction (streaming).
    setMsgs((m) => [...m, { role: "assistant", content: "", nav: [] }]);
    try {
      const r = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!r.ok || !r.body) throw new Error("stream");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.trim();
          if (!line.startsWith("data:")) continue;
          let ev: { type: string; text?: string; path?: string; label?: string; error?: string };
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === "text" && ev.text) {
            setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + ev.text }; return c; });
          } else if (ev.type === "navigate" && ev.path) {
            setMsgs((m) => { const c = [...m]; const last = c[c.length - 1]; c[c.length - 1] = { ...last, nav: [...(last.nav ?? []), { path: ev.path!, label: ev.label || ev.path! }] }; return c; });
          } else if (ev.type === "error") {
            setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: (c[c.length - 1].content || "") + `\n⚠️ ${ev.error}` }; return c; });
          }
        }
      }
    } catch {
      setMsgs((m) => { const c = [...m]; const last = c[c.length - 1]; if (last?.role === "assistant" && !last.content) c[c.length - 1] = { ...last, content: "Assistant indisponible, réessayez." }; return c; });
    } finally { setBusy(false); }
  }, [input, busy, msgs, model]);

  const go = (path: string) => { setOpen(false); router.push(path); };

  if (!enabled) return null;
  const current = models.find((m) => m.id === model);

  return (
    <>
      {/* Bouton flottant — masqué en coquille tactile (barre d'onglets basse) */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Assistant d'aide"
        className="fixed bottom-5 right-5 z-[70] hidden md:flex touch:!hidden h-13 w-13 items-center justify-center rounded-full bg-brand-500 text-black shadow-[0_8px_24px_rgba(0,0,0,0.28)] ring-1 ring-black/10 transition-transform hover:scale-105 active:scale-95"
        style={{ height: 52, width: 52 }}
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed bottom-20 right-5 z-[70] hidden md:flex touch:!hidden flex-col w-[380px] max-w-[calc(100vw-2.5rem)] h-[560px] max-h-[calc(100vh-7rem)] rounded-2xl border border-border bg-card shadow-modal overflow-hidden"
          >
            {/* En-tête + sélecteur de modèle */}
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 h-14 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400"><Sparkles className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground leading-none">Assistant Gervi</p>
                  <div className="relative">
                    <button type="button" onClick={() => setModelMenu((v) => !v)} className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      {current?.label ?? "Modèle"} <ChevronDown className="h-3 w-3" />
                    </button>
                    {modelMenu && (
                      <div className="absolute left-0 top-6 z-10 w-64 rounded-xl border border-border bg-popover p-1 shadow-modal">
                        {models.map((m) => (
                          <button key={m.id} type="button" onClick={() => pickModel(m.id)}
                            className={`w-full text-left rounded-lg px-2.5 py-2 hover:bg-secondary ${m.id === model ? "bg-secondary" : ""}`}>
                            <span className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">{m.label}
                              <span className="rounded px-1.5 py-0.5 text-[10px] bg-brand-500/12 text-brand-600 dark:text-brand-400">{m.tier}</span></span>
                            <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{m.note}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>

            {/* Fil de discussion */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {msgs.length === 0 && (
                <div className="text-center py-8">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/12 text-brand-600 dark:text-brand-400 mb-3"><Sparkles className="h-6 w-6" /></span>
                  <p className="text-[14px] font-semibold text-foreground">Comment puis-je aider ?</p>
                  <p className="text-[12px] text-muted-foreground mt-1">Pose une question sur l'utilisation du logiciel.</p>
                  <div className="mt-3 flex flex-col gap-1.5">
                    {["Où voir les créances clients ?", "Comment poser un congé ?", "Où sont les entrées marchandises ?"].map((q) => (
                      <button key={q} type="button" onClick={() => { setInput(q); setTimeout(send, 20); }}
                        className="text-left rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] text-foreground hover:bg-secondary transition-colors">{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-brand-500 text-black" : "bg-secondary text-foreground"}`}>
                    {m.content || (busy && i === msgs.length - 1 ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : "")}
                    {m.nav && m.nav.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {m.nav.map((n, k) => (
                          <button key={k} type="button" onClick={() => go(n.path)}
                            className="inline-flex items-center justify-between gap-2 rounded-lg bg-background border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-secondary transition-colors">
                            Ouvrir « {n.label} » <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Saisie */}
            <div className="shrink-0 border-t border-border p-3">
              <div className="flex items-end gap-2 rounded-xl border border-input bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
                <textarea
                  ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Votre question…" disabled={busy}
                  className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none max-h-24"
                />
                <button type="button" onClick={send} disabled={busy || !input.trim()}
                  className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center bg-brand-500 text-black disabled:opacity-40 hover:bg-brand-400 transition-colors">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground">L'assistant conseille et ouvre des écrans — il ne réalise aucune action à votre place.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
