"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, ImagePlus, Loader2, X, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressImage, MAX_PHOTOS, type DraftPhoto } from "./inv-utils";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const ko = (bytes: number) => `${Math.round(bytes / 1024)} Ko`;

export function PhotoStep({
  photos,
  onChange,
  onPreview,
}: {
  photos: DraftPhoto[];
  onChange: (next: DraftPhoto[]) => void;
  onPreview?: (dataUrl: string) => void;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      toast.error(`Maximum ${MAX_PHOTOS} photos.`);
      return;
    }
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast.message(`Seules ${room} photo(s) ajoutées (max ${MAX_PHOTOS}).`);
    setBusy(true);
    const added: DraftPhoto[] = [];
    for (const f of list) {
      if (!f.type.startsWith("image/")) continue;
      try {
        added.push(await compressImage(f, uid()));
      } catch {
        toast.error(`« ${f.name} » illisible.`);
      }
    }
    setBusy(false);
    if (added.length) onChange([...photos, ...added]);
  }

  function remove(id: string) {
    onChange(photos.filter((p) => p.id !== id));
  }

  const full = photos.length >= MAX_PHOTOS;
  const totalKo = photos.reduce((s, p) => s + p.bytes, 0);

  return (
    <div className="space-y-4">
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
      />
      <input
        ref={galRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
      />

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          size="lg"
          className="h-16 text-[15px] flex-col gap-1"
          disabled={busy || full}
          onClick={() => camRef.current?.click()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Camera className="!size-6" />}
          Prendre une photo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-16 text-[15px] flex-col gap-1"
          disabled={busy || full}
          onClick={() => galRef.current?.click()}
        >
          <ImagePlus className="!size-6" />
          Depuis la galerie
        </Button>
      </div>

      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>{photos.length} / {MAX_PHOTOS} photo(s)</span>
        {photos.length > 0 && <span className="tnum">≈ {ko(totalKo)}</span>}
      </div>

      {photos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <Camera className="h-7 w-7 mx-auto text-muted-foreground/60" />
          <p className="mt-2 text-[13px] text-muted-foreground">
            Aucune photo. Prends quelques clichés de l&apos;entrepôt (zones, rayons, anomalies…).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt="photo entrepôt" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition active:scale-90"
                aria-label="Supprimer la photo"
              >
                <X className="h-4 w-4" />
              </button>
              {onPreview && (
                <button
                  type="button"
                  onClick={() => onPreview(p.dataUrl)}
                  className="absolute bottom-1 left-1 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 active:scale-90"
                  aria-label="Agrandir"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
