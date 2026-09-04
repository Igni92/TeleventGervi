"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, LogOut, Clock, CalendarDays, Timer, MapPin, Lock, FileText, Download } from "lucide-react";
import { MovingBorderButton } from "@/components/ui/moving-border-button";

type MeState = {
  badgeuseEnabled?: boolean;
  employee: { name: string | null; email: string };
  today: { inside: boolean; workedMin: number; punches: { kind: string; at: string }[] };
  contract: { type: string; heuresHebdo: number; heuresAnnuelles: number } | null;
  soldes: { cpSolde: number; recupSoldeMin: number; recupCapMin: number };
  documents?: { id: string; type: string; nom: string; createdAt: string }[];
};

const fmtHM = (min: number) => `${Math.floor(Math.max(0, min) / 60)}h${String(Math.round(Math.max(0, min) % 60)).padStart(2, "0")}`;
const fmtHeure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Espace salarié — BADGEUSE : « J'arrive / Je pars » géolocalisé + heures du jour
 *  + compteurs (récup, CP). Mobile-first, 1 geste pour badger. */
export function EmployeeHome() {
  const [me, setMe] = useState<MeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/rh/me", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.ok) setMe(j);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Rafraîchit le compteur du jour chaque minute quand on est « au travail ».
  useEffect(() => {
    if (!me?.today.inside) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [me?.today.inside, load]);

  const geolocate = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Géolocalisation indisponible"));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
    });

  const punch = async (kind: "in" | "out") => {
    setPunching(true);
    try {
      let pos: GeolocationPosition;
      try { pos = await geolocate(); }
      catch { toast.error("Active la géolocalisation pour badger."); return; }
      const r = await fetch("/api/rh/punch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || "Pointage refusé"); return; }
      toast.success(kind === "in" ? "Arrivée enregistrée. Bonne journée !" : `Départ enregistré — ${fmtHM(j.workedMin)} aujourd'hui.`);
      await load();
    } finally { setPunching(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!me) return <p className="text-center text-muted-foreground py-16">Espace RH indisponible.</p>;

  const inside = me.today.inside;
  return (
    <div className="mx-auto max-w-md space-y-5 pb-8">
      <header className="pt-1">
        <p className="text-[13px] text-muted-foreground">Bonjour</p>
        <h1 className="text-[22px] font-bold text-foreground leading-tight">{me.employee.name ?? me.employee.email}</h1>
      </header>

      {/* Badgeuse désactivée → présence gérée selon les horaires du contrat. */}
      {me.badgeuseEnabled === false ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/12 text-sky-600 dark:text-sky-400 mb-2"><CalendarDays className="h-6 w-6" /></span>
          <p className="text-[15px] font-semibold text-foreground">Présence selon votre contrat</p>
          <p className="text-[12px] text-muted-foreground mt-1">La badgeuse est désactivée. Vos heures sont comptées selon les horaires prévus à votre contrat ; signalez vos absences via vos congés.</p>
        </div>
      ) : (
      /* Bouton BADGEUSE — géant, bordure animée (halo vert « J'arrive » / rouge
          « Je pars »). Une seule action selon l'état. */
      <MovingBorderButton
        type="button"
        onClick={() => punch(inside ? "out" : "in")}
        disabled={punching}
        borderRadius="1.75rem"
        duration={2800}
        containerClassName="w-full block shadow-lg transition-transform active:scale-[0.98] disabled:opacity-70"
        borderChildClassName={`h-28 w-28 ${inside
          ? "bg-[radial-gradient(#fda4af_45%,transparent_60%)]"
          : "bg-[radial-gradient(#6ee7b7_45%,transparent_60%)]"}`}
        className={`flex-col gap-2 p-6 text-white bg-gradient-to-br ${inside
          ? "from-rose-900 via-rose-950 to-neutral-950"
          : "from-emerald-900 via-emerald-950 to-neutral-950"}`}
      >
        <span className="flex items-center justify-center gap-3 text-[22px] font-bold">
          {punching ? <Loader2 className="h-7 w-7 animate-spin" /> : inside ? <LogOut className="h-7 w-7" /> : <LogIn className="h-7 w-7" />}
          {inside ? "Je pars" : "J'arrive"}
        </span>
        <span className="flex items-center justify-center gap-1.5 text-[13px] text-white/85">
          <MapPin className="h-3.5 w-3.5" /> Pointage géolocalisé
        </span>
      </MovingBorderButton>
      )}

      {/* Heures du jour */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground"><Clock className="h-4 w-4" /> Aujourd'hui</span>
          <span className="text-[24px] font-bold tnum text-foreground">{fmtHM(me.today.workedMin)}</span>
        </div>
        {me.today.punches.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {me.today.punches.map((p, i) => (
              <span key={i} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-medium ${p.kind === "in" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/12 text-rose-700 dark:text-rose-300"}`}>
                {p.kind === "in" ? "Arrivée" : "Départ"} {fmtHeure(p.at)}
              </span>
            ))}
          </div>
        )}
        {inside && <p className="mt-2 text-[12px] text-emerald-600 dark:text-emerald-400">● En cours — le compteur tourne.</p>}
      </div>

      {/* Compteurs : récup + CP + contrat */}
      <div className="grid grid-cols-2 gap-3">
        <Tile icon={<Timer className="h-4 w-4" />} label="Récup" value={fmtHM(me.soldes.recupSoldeMin)}
          hint={me.soldes.recupCapMin > 0 ? `plafond ${fmtHM(me.soldes.recupCapMin)}` : undefined} />
        <Tile icon={<CalendarDays className="h-4 w-4" />} label="Congés (CP)" value={`${me.soldes.cpSolde.toFixed(1)} j`} />
      </div>
      {me.contract && (
        <p className="text-center text-[12px] text-muted-foreground">
          Contrat {me.contract.type} · {me.contract.heuresHebdo} h/sem · {me.contract.heuresAnnuelles} h/an
        </p>
      )}

      {/* Mes documents (coffre-fort — lecture) */}
      {me.documents && me.documents.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground mb-2"><Lock className="h-4 w-4" /> Mes documents</span>
          <ul className="space-y-1.5">
            {me.documents.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={async () => {
                  const r = await fetch(`/api/rh/documents/${d.id}`); const j = await r.json();
                  if (r.ok && j.ok) { const a = document.createElement("a"); a.href = j.contenu; a.download = j.nom; a.click(); }
                  else toast.error("Téléchargement impossible");
                }} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-secondary/50 text-[13px]">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{d.nom}</span>
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">{icon} {label}</span>
      <div className="mt-1 text-[20px] font-bold tnum text-foreground">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
