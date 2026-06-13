"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown, Mail, ArrowRight, Loader2, Users,
  Building2, Globe, Store, Check, X, Percent,
} from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Counts { ALL: number; CHR: number; GMS: number; EXPORT: number; OTHER: number; }

interface Props {
  userId: string;
  name: string;
  email: string | null;
  counts: Counts;
  isMe?: boolean;
  present?: boolean;
  stockSharePct?: number;
}

export function CommercialCard({ userId, name, email, counts, isMe, present = true, stockSharePct = 100 }: Props) {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [isPresent, setIsPresent] = useState(present);
  const [share, setShare] = useState(stockSharePct);
  const [savingPresence, setSavingPresence] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch("/api/commerciaux", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...payload }),
    });
    if (!res.ok) throw new Error();
  }
  async function togglePresence() {
    const next = !isPresent;
    setIsPresent(next); setSavingPresence(true);
    try { await patch({ present: next }); toast.success(next ? `${name} présent(e)` : `${name} absent(e) — clients à couvrir`); }
    catch { setIsPresent(!next); toast.error("Erreur présence"); }
    finally { setSavingPresence(false); }
  }
  async function saveShare(v: number) {
    const pct = Math.max(0, Math.min(100, v));
    setShare(pct);
    try { await patch({ stockSharePct: pct }); } catch { toast.error("Erreur % stock"); }
  }

  async function claim(type: "ALL" | "CHR" | "GMS" | "EXPORT") {
    setClaiming(type);
    try {
      const res = await fetch("/api/temp-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commercial: name, type }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const created = data.created ?? 0;
      const skipped = data.skipped ?? 0;
      if (created === 0 && skipped === 0) {
        toast("Aucun client à récupérer", { description: `${name} n'a pas de clients ${type === "ALL" ? "" : type}.` });
      } else {
        toast.success(
          `${created} client${created > 1 ? "s" : ""} récupéré${created > 1 ? "s" : ""}`,
          { description: skipped > 0 ? `${skipped} déjà couvert${skipped > 1 ? "s" : ""}` : `Visible dans ta console aujourd'hui` },
        );
      }
    } catch {
      toast.error("Erreur lors de la récupération");
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 flex items-start justify-between gap-3 hover:border-foreground/20 transition-colors">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {/* Avatar */}
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-white font-bold text-[13px] shadow-[0_0_0_2px_rgba(99,102,241,0.18)]">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground truncate text-[14px]">{name}</p>
            {isMe && (
              <span className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-brand-600 text-white">
                vous
              </span>
            )}
          </div>
          {email && (
            <p className="text-[11.5px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
              <Mail className="h-3 w-3 flex-shrink-0" />
              {email}
            </p>
          )}

          {/* Type breakdown */}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground tnum">
            <span className="font-semibold text-foreground">{counts.ALL}</span>
            <span>clients</span>
            <span className="opacity-30">·</span>
            {counts.CHR > 0 && <span><span className="font-medium text-foreground/80 tnum">{counts.CHR}</span> CHR</span>}
            {counts.GMS > 0 && <span><span className="font-medium text-foreground/80 tnum">{counts.GMS}</span> GMS</span>}
            {counts.EXPORT > 0 && <span><span className="font-medium text-foreground/80 tnum">{counts.EXPORT}</span> EXPORT</span>}
          </div>

          {/* Présence + % stock attribué */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              type="button"
              onClick={togglePresence}
              disabled={savingPresence}
              className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                isPresent
                  ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
              }`}
            >
              {savingPresence ? <Loader2 className="h-3 w-3 animate-spin" /> : isPresent ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {isPresent ? "Présent" : "Absent"}
            </button>
            <label className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-secondary/60 text-[11px] text-muted-foreground" title="% du stock total attribué à ce commercial">
              <Percent className="h-3 w-3" />
              <input
                type="number" min={0} max={100} step={5}
                value={share}
                onChange={(e) => setShare(parseFloat(e.target.value) || 0)}
                onBlur={(e) => saveShare(parseFloat(e.target.value) || 0)}
                className="w-10 bg-transparent text-right tnum text-foreground focus:outline-none"
              />
              <span>stock</span>
            </label>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Link
          href={`/clients?commercial=${encodeURIComponent(name)}`}
          className="text-[11.5px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 border-b border-border hover:border-foreground pb-0.5"
        >
          Voir clients
          <ArrowRight className="h-3 w-3" />
        </Link>

        {!isMe && counts.ALL > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={!!claiming}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors active:scale-[0.97] disabled:opacity-60"
              >
                {claiming ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    Récupérer
                    <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
                Récupérer pour aujourd&apos;hui
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => claim("ALL")}
                className="cursor-pointer flex items-center gap-2 text-[13px]"
              >
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Tous les clients
                <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.ALL}</span>
              </DropdownMenuItem>

              {counts.CHR > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("CHR")}
                  className="cursor-pointer flex items-center gap-2 text-[13px]"
                >
                  <Store className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement CHR
                  <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.CHR}</span>
                </DropdownMenuItem>
              )}
              {counts.GMS > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("GMS")}
                  className="cursor-pointer flex items-center gap-2 text-[13px]"
                >
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement GMS
                  <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.GMS}</span>
                </DropdownMenuItem>
              )}
              {counts.EXPORT > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("EXPORT")}
                  className="cursor-pointer flex items-center gap-2 text-[13px]"
                >
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement EXPORT
                  <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.EXPORT}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[10.5px] text-muted-foreground leading-tight">
                Les clients récupérés apparaîtront dans votre console jusqu&apos;à minuit.
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
