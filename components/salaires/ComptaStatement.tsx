"use client";

/**
 * ÉTAT COMPTABLE — la vue PROFESSIONNELLE des éléments des salaires : un
 * document sobre, mois par mois (LISTE DÉROULANTE — comme des PDF « mars,
 * avril, mai… »), avec les heures de toute l'équipe et les éléments de paie.
 * Lecture seule, imprimable en A4 d'un clic.
 *
 * C'est l'écran du CABINET COMPTABLE (profil confiné → barre de navigation
 * dédiée : Planning + déconnexion) ; l'admin y accède aussi via l'onglet
 * « État comptable » de /salaires.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, Printer, CalendarDays, LogOut, CheckCircle2 } from "lucide-react";
import { fmtHM, monthIdOf, shiftMonth } from "@/lib/heuresCalc";
import { salaireMonthLabel, type SalaryFrais, type SalaryHeures, type SalaryMonthData, type SalaryPrime, type SalaryProfile } from "@/lib/salaires";
import { printEtatSalaires } from "@/lib/salairesPdf";

interface Row {
  email: string;
  name: string;
  heures: SalaryHeures;
  salary: SalaryMonthData | null;
  profile: SalaryProfile | null;
  anMensuel: number;
  missing: string[];
}
interface ApiData {
  ok: boolean; month: string; rows: Row[];
  sent: { sentAt: string; sentBy: string; to: string[] } | null;
}

const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

/** Les 18 derniers mois (mois courant inclus) — la liste déroulante. */
function monthOptions(): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  let m = monthIdOf(new Date());
  for (let i = 0; i < 18; i++) {
    out.push({ id: m, label: salaireMonthLabel(m) });
    m = shiftMonth(m, -1);
  }
  return out;
}

export function ComptaStatement({ showNav }: { showNav: boolean }) {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].id);
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/salaires?month=${month}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ApiData | null;
      if (j?.ok) setData(j);
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) =>
      r.heures.weeksWithData > 0 || (r.salary && (r.salary.primes.length > 0 || r.salary.frais.length > 0))),
    [data],
  );

  const print = () => {
    const ok = printEtatSalaires(month, rows.map((r) => ({
      name: r.name, heures: r.heures, anMensuel: r.anMensuel,
      vehicule: r.profile?.vehicule ?? null,
      primes: r.salary?.primes ?? [], frais: r.salary?.frais ?? [], note: r.salary?.note,
    })));
    if (!ok) toast.error(rows.length === 0 ? "Aucune donnée ce mois-ci." : "Impression bloquée — autorisez les pop-ups.");
  };

  const details = (r: Row): string[] => [
    ...(r.salary?.primes ?? []).map((p: SalaryPrime) =>
      `Prime — ${p.motif} : ${eur(p.montant)}${p.bulletinDe !== month ? ` (bulletin de ${salaireMonthLabel(p.bulletinDe)})` : ""}${p.note ? ` — ${p.note}` : ""}`),
    ...(r.salary?.frais ?? []).map((f: SalaryFrais) => `Frais — ${f.motif} : ${eur(f.montant)}${f.note ? ` — ${f.note}` : ""}`),
    ...(r.profile?.vehicule ? [`Avantage en nature — ${r.profile.vehicule.type} : ${eur(r.anMensuel)} / mois`] : []),
    ...(r.salary?.note ? [`Note : ${r.salary.note}`] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      {/* Barre du CABINET (profil confiné : il n'a pas la navigation de l'app). */}
      {showNav && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
          <span className="text-[13px] font-bold text-foreground">Gervifrais — Espace comptable</span>
          <a href="/planning" className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            <CalendarDays className="h-4 w-4" /> Planning
          </a>
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
        </div>
      )}

      {/* En-tête document : mois (liste déroulante) + impression. */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">Gervifrais · Compta / paie</p>
            <h2 className="text-[16px] font-bold text-foreground">Éléments des salaires</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mois"
              className="h-10 rounded-lg border border-border bg-background px-3 text-[13px] font-semibold capitalize focus:outline-none focus:ring-1 focus:ring-brand-500">
              {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button type="button" onClick={print} disabled={loading || rows.length === 0}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 disabled:opacity-50">
              <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Imprimer /</span> PDF
            </button>
          </div>
        </div>

        {loading && !data ? (
          <p className="px-4 py-5 sm:px-6 text-[13px] text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-5 sm:px-6 text-[13px] italic text-muted-foreground">Aucune donnée pour {salaireMonthLabel(month)}.</p>
        ) : (
          <>
            {/* DESKTOP : tableau document. */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b-2 border-foreground/60">
                    <th className="text-left font-semibold px-6 py-2.5">Salarié</th>
                    <th className="text-right font-semibold px-2 py-2.5">Heures</th>
                    <th className="text-right font-semibold px-2 py-2.5">Supp payées</th>
                    <th className="text-right font-semibold px-2 py-2.5">Supp → récup</th>
                    <th className="text-right font-semibold px-2 py-2.5">Férié</th>
                    <th className="text-right font-semibold px-2 py-2.5">CP</th>
                    <th className="text-right font-semibold px-2 py-2.5">Maladie</th>
                    <th className="text-right font-semibold px-2 py-2.5">Absence</th>
                    <th className="text-right font-semibold px-2 py-2.5">Primes</th>
                    <th className="text-right font-semibold px-2 py-2.5">AN</th>
                    <th className="text-right font-semibold px-6 py-2.5">Frais</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const h = r.heures;
                    const primesTotal = (r.salary?.primes ?? []).reduce((s, p) => s + p.montant, 0);
                    const fraisTotal = (r.salary?.frais ?? []).reduce((s, f) => s + f.montant, 0);
                    const det = details(r);
                    return (
                      <tr key={r.email} className="border-b border-border/60 align-top">
                        <td className="px-6 py-2.5">
                          <span className="font-bold text-foreground">{r.name}</span>
                          {det.length > 0 && (
                            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                              {det.map((d, i) => <span key={i} className="block">{d}</span>)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right tnum font-semibold">{fmtHM(h.totalMin)}</td>
                        <td className="px-2 py-2.5 text-right tnum font-bold">{h.suppPayEquivMin > 0 ? fmtHM(h.suppPayEquivMin) : "—"}</td>
                        <td className="px-2 py-2.5 text-right tnum">{h.suppRecupEquivMin > 0 ? fmtHM(h.suppRecupEquivMin) : "—"}</td>
                        <td className="px-2 py-2.5 text-right tnum">{h.ferieMin > 0 ? fmtHM(h.ferieMin) : "—"}</td>
                        <td className="px-2 py-2.5 text-right tnum">{h.cpJours > 0 ? `${h.cpJours} j` : "—"}</td>
                        <td className="px-2 py-2.5 text-right tnum">{h.maladieJours > 0 ? `${h.maladieJours} j` : "—"}</td>
                        <td className="px-2 py-2.5 text-right tnum">{h.absentJours > 0 ? `${h.absentJours} j` : "—"}</td>
                        <td className="px-2 py-2.5 text-right tnum font-bold">{primesTotal > 0 ? eur(primesTotal) : "—"}</td>
                        <td className="px-2 py-2.5 text-right tnum">{r.anMensuel > 0 ? eur(r.anMensuel) : "—"}</td>
                        <td className="px-6 py-2.5 text-right tnum">{fraisTotal > 0 ? eur(fraisTotal) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE : une fiche sobre par salarié — l'essentiel, sans boutons. */}
            <div className="md:hidden divide-y divide-border/60">
              {rows.map((r) => {
                const h = r.heures;
                const primesTotal = (r.salary?.primes ?? []).reduce((s, p) => s + p.montant, 0);
                const fraisTotal = (r.salary?.frais ?? []).reduce((s, f) => s + f.montant, 0);
                const det = details(r);
                return (
                  <div key={r.email} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[14px] font-bold text-foreground">{r.name}</span>
                      <span className="text-[15px] font-bold tnum text-foreground shrink-0">{fmtHM(h.totalMin)}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] tnum text-muted-foreground">
                      {h.suppPayEquivMin > 0 && <span>Supp payées <b className="text-foreground">{fmtHM(h.suppPayEquivMin)}</b></span>}
                      {h.suppRecupEquivMin > 0 && <span>Supp → récup <b className="text-foreground">{fmtHM(h.suppRecupEquivMin)}</b></span>}
                      {h.ferieMin > 0 && <span>Férié <b className="text-foreground">{fmtHM(h.ferieMin)}</b></span>}
                      {h.cpJours > 0 && <span>CP <b className="text-foreground">{h.cpJours} j</b></span>}
                      {h.maladieJours > 0 && <span>Maladie <b className="text-foreground">{h.maladieJours} j</b></span>}
                      {h.absentJours > 0 && <span>Absence <b className="text-foreground">{h.absentJours} j</b></span>}
                      {primesTotal > 0 && <span>Primes <b className="text-foreground">{eur(primesTotal)}</b></span>}
                      {r.anMensuel > 0 && <span>AN <b className="text-foreground">{eur(r.anMensuel)}</b></span>}
                      {fraisTotal > 0 && <span>Frais <b className="text-foreground">{eur(fraisTotal)}</b></span>}
                    </div>
                    {det.length > 0 && (
                      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                        {det.map((d, i) => <span key={i} className="block">{d}</span>)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 sm:px-6">
              {data?.sent ? (
                <p className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Récapitulatif transmis le {new Date(data.sent.sentAt).toLocaleDateString("fr-FR")}
                </p>
              ) : (
                <p className="text-[12px] italic text-muted-foreground">Récapitulatif pas encore transmis pour ce mois.</p>
              )}
              <p className="ml-auto text-[11px] text-muted-foreground">
                Supp payées = équiv. majoré décidé · fériés toujours payés · AN = forfait mensuel véhicule
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
