"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Loader2, Plus, UserPlus, FileSignature, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Contract = {
  id: string; type: string; statut: string; dateDebut: string; dateFin: string | null;
  essaiFin: string | null; heuresHebdo: number; heuresAnnuelles: number; saisonLabel: string | null;
};
type Emp = {
  id: string; email: string; displayName: string | null; poste: string | null; service: string | null;
  statutEmploi: string; sapSlpName: string | null; contracts: Contract[];
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const daysUntil = (iso: string | null): number | null => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000) : null);

export function ContractsPanel() {
  const [emps, setEmps] = useState<Emp[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<null | { mode: "hire" | "contract"; emp?: Emp }>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/rh/contracts", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.ok) { setEmps(j.employees); setTypes(j.types); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ mode: "hire" })}><UserPlus className="h-4 w-4" /> Embaucher</Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Salarié</th>
                <th className="text-left px-3 py-2 font-semibold w-28">Contrat</th>
                <th className="text-left px-3 py-2 font-semibold w-40">Période</th>
                <th className="text-left px-3 py-2 font-semibold w-44">Statut</th>
                <th className="text-right px-3 py-2 font-semibold w-32" />
              </tr>
            </thead>
            <tbody>
              {emps.map((e) => {
                const c = e.contracts.find((x) => x.statut === "actif") ?? e.contracts[0] ?? null;
                const essaiIn = daysUntil(c?.essaiFin ?? null);
                const cddIn = daysUntil(c?.dateFin ?? null);
                return (
                  <tr key={e.id} className="border-t border-border/60 hover:bg-secondary/30">
                    <td className="px-3 py-2.5">
                      <Link href={`/rh/salarie/${e.id}`} className="font-semibold text-foreground hover:text-primary hover:underline underline-offset-2">{e.displayName ?? e.email}</Link>
                      {e.sapSlpName && <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">{e.sapSlpName}</span>}
                      <div className="text-[11px] text-muted-foreground">{[e.poste, e.service].filter(Boolean).join(" · ") || e.email}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {c ? <span className="font-medium">{c.type}</span> : <span className="text-muted-foreground">—</span>}
                      {c && <div className="text-[11px] text-muted-foreground tnum">{c.heuresHebdo}h/sem</div>}
                      {c?.saisonLabel && <div className="text-[11px] text-amber-600 dark:text-amber-400">{c.saisonLabel}</div>}
                    </td>
                    <td className="px-3 py-2.5 tnum text-muted-foreground">
                      {c ? <>{fmt(c.dateDebut)}{c.dateFin ? ` → ${fmt(c.dateFin)}` : ""}</> : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {e.statutEmploi === "sorti" ? (
                        <Badge tone="zinc">Sorti</Badge>
                      ) : essaiIn != null && essaiIn >= 0 && essaiIn <= 30 ? (
                        <Badge tone="amber"><AlertTriangle className="h-3 w-3" /> Essai fin dans {essaiIn}j</Badge>
                      ) : cddIn != null && cddIn >= 0 && cddIn <= 30 ? (
                        <Badge tone="rose"><AlertTriangle className="h-3 w-3" /> Fin {c?.type} dans {cddIn}j</Badge>
                      ) : c ? (
                        <Badge tone="emerald">Actif</Badge>
                      ) : (
                        <Badge tone="zinc">Sans contrat</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "contract", emp: e })}>
                        <FileSignature className="h-3.5 w-3.5" /> {c ? "Renouveler" : "Contrat"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {emps.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Aucun salarié.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {dialog && (
        <ContractDialog
          mode={dialog.mode} emp={dialog.emp} types={types}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "emerald" | "amber" | "rose" | "zinc"; children: React.ReactNode }) {
  const cls = {
    emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    zinc: "bg-secondary text-muted-foreground",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${cls}`}>{children}</span>;
}

function ContractDialog({ mode, emp, types, onClose, onSaved }: {
  mode: "hire" | "contract"; emp?: Emp; types: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  // Champs embauche
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [poste, setPoste] = useState("");
  // Champs contrat
  const [type, setType] = useState("CDI");
  const [dateDebut, setDateDebut] = useState(new Date().toISOString().slice(0, 10));
  const [dateFin, setDateFin] = useState("");
  const [essaiFin, setEssaiFin] = useState("");
  const [heuresHebdo, setHeuresHebdo] = useState("35");
  const [saisonLabel, setSaisonLabel] = useState("");
  const openEnded = type === "CDI" || type === "ADMINISTRATEUR"; // durée indéterminée → pas de fin
  const seasonal = type === "CDD" || type === "SAISONNIER";

  const submit = async () => {
    setSaving(true);
    try {
      const contract = {
        type, dateDebut, dateFin: dateFin || undefined, essaiFin: essaiFin || undefined,
        heuresHebdo: Number(heuresHebdo) || 35, saisonLabel: saisonLabel || undefined,
      };
      let r: Response;
      if (mode === "hire") {
        if (!email.includes("@")) { toast.error("Email valide requis"); return; }
        r = await fetch("/api/rh/employees", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, displayName: displayName || undefined, poste: poste || undefined, hireDate: dateDebut, contract }) });
      } else {
        r = await fetch("/api/rh/contracts", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId: emp!.id, ...contract }) });
      }
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
      toast.success(mode === "hire" ? "Salarié embauché" : "Contrat créé");
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            {mode === "hire" ? <UserPlus className="h-5 w-5" /> : <FileSignature className="h-5 w-5" />}
            {mode === "hire" ? "Nouvelle embauche" : `Contrat — ${emp?.displayName ?? emp?.email}`}
          </DialogTitle>
          <DialogDescription className="text-caption">
            {mode === "hire" ? "Crée le salarié et son premier contrat." : "Nouveau contrat (les contrats actifs précédents sont clôturés)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {mode === "hire" && (
            <>
              <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@gervifrais.com" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Nom affiché"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Prénom Nom" /></Field>
                <Field label="Poste"><Input value={poste} onChange={(e) => setPoste(e.target.value)} placeholder="Préparateur…" /></Field>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type de contrat">
              <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-body">
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Heures/sem"><Input type="number" value={heuresHebdo} onChange={(e) => setHeuresHebdo(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Début"><Input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} /></Field>
            {openEnded
              ? <div className="flex items-end pb-1 text-[11px] text-muted-foreground">Durée indéterminée — pas de date de fin.</div>
              : <Field label={seasonal ? "Fin (CDD/saison)" : "Fin"}><Input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} /></Field>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fin période d'essai"><Input type="date" value={essaiFin} onChange={(e) => setEssaiFin(e.target.value)} /></Field>
            {seasonal && <Field label="Libellé saison"><Input value={saisonLabel} onChange={(e) => setSaisonLabel(e.target.value)} placeholder="Saison fraises 2026" /></Field>}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" size="xl" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button size="xl" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Enregistrer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-caption font-medium text-foreground">{label}</span><div className="mt-1">{children}</div></label>;
}
