"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, Upload, Trash2, ImageOff, Tags, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SurfaceCard } from "@/components/ui/surface-card";

interface Marque { marque: string; logoUrl: string | null }

/** Redimensionne une image (fichier) en data-URL PNG ≤ `max` px — logo léger.
 *  256 px : reste net même en vue agrandie (clic sur le logo → lightbox). */
function fileToLogoDataUrl(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image illisible"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
        const w = Math.max(1, Math.round((img.width || max) * scale));
        const h = Math.max(1, Math.round((img.height || max) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas indisponible")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function MarquesLogosPanel() {
  const [marques, setMarques] = useState<Marque[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Input fichier piloté par marque (un seul input réutilisé).
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingMarque = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/marques", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { marques?: Marque[] }) => { if (!cancelled) setMarques(j.marques ?? []); })
      .catch(() => { if (!cancelled) setMarques([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? marques.filter((m) => m.marque.toLowerCase().includes(q)) : marques;
  }, [marques, query]);

  const withLogo = marques.filter((m) => m.logoUrl).length;

  const pickFor = (marque: string) => {
    pendingMarque.current = marque;
    fileInput.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const marque = pendingMarque.current;
    e.target.value = ""; // autorise re-sélection du même fichier
    if (!file || !marque) return;
    setBusy(marque);
    try {
      const logoUrl = await fileToLogoDataUrl(file);
      const res = await fetch("/api/marques/logos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marque, logoUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Échec");
      setMarques((cur) => cur.map((m) => (m.marque === marque ? { ...m, logoUrl } : m)));
      toast.success(`Logo enregistré — ${marque}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'enregistrement");
    } finally {
      setBusy(null);
      pendingMarque.current = null;
    }
  };

  const removeLogo = async (marque: string) => {
    setBusy(marque);
    try {
      const res = await fetch(`/api/marques/logos?marque=${encodeURIComponent(marque)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Échec");
      setMarques((cur) => cur.map((m) => (m.marque === marque ? { ...m, logoUrl: null } : m)));
      toast.success(`Logo retiré — ${marque}`);
    } catch {
      toast.error("Suppression impossible");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <SurfaceCard accent="violet" title="Marques & logos" icon={<Tags className="h-3.5 w-3.5" />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[12px] text-muted-foreground max-w-md">
              Associe un logo à chaque marque. Il s&apos;affiche dans une tuile blanche
              carrée uniforme (console, préparation, inventaire). Pour un rendu net :
              <b> PNG à fond transparent ou blanc</b>, logo détouré et centré, idéalement
              carré (≥ 128&nbsp;px). Les logos clairs sur fond transparent sont à éviter
              (invisibles sur fond blanc).
            </p>
            <span className="text-[11.5px] font-semibold text-muted-foreground tnum shrink-0">
              {withLogo}/{marques.length} avec logo
            </span>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer une marque…"
              className="w-full h-9 pl-9 pr-2 rounded-md border border-border bg-background text-[13.5px] focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {loading ? (
            <p className="text-[13px] text-muted-foreground inline-flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement des marques…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-muted-foreground/70 italic py-4">
              {marques.length === 0 ? "Aucune marque dans le catalogue." : "Aucune marque ne correspond."}
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60 overflow-hidden">
              {filtered.map((m) => (
                <li key={m.marque} className="flex items-center gap-3 px-3 py-2.5 bg-card/40">
                  {/* Aperçu logo — même tuile blanche que l'affichage réel */}
                  <span className="h-12 w-12 shrink-0 rounded-lg bg-white ring-1 ring-black/10 flex items-center justify-center overflow-hidden p-1">
                    {m.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.logoUrl} alt={m.marque} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <ImageOff className="h-4 w-4 text-muted-foreground/40" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold text-foreground truncate">{m.marque}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {m.logoUrl ? "Logo défini" : "Pas de logo"}
                    </span>
                  </span>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => pickFor(m.marque)}
                      disabled={busy === m.marque}
                      className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md text-[12px] font-semibold bg-secondary/60 hover:bg-secondary text-foreground disabled:opacity-50"
                    >
                      {busy === m.marque ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {m.logoUrl ? "Remplacer" : "Logo"}
                    </button>
                    {m.logoUrl && (
                      <button
                        type="button"
                        onClick={() => removeLogo(m.marque)}
                        disabled={busy === m.marque}
                        title="Retirer le logo"
                        className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SurfaceCard>

      <Link href="/parametres" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Retour aux paramètres
      </Link>
    </div>
  );
}
