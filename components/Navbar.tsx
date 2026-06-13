"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { LogOut, Phone, ChevronDown, LayoutDashboard, Users, Briefcase, Radio, Package, PackagePlus, Factory, ClipboardList, Receipt } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ColorimetrieSwitcher } from "@/components/ColorimetrieSwitcher";
import { SapEnvSwitch } from "@/components/SapEnvSwitch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_LINKS = [
  { href: "/console",     label: "Console",       icon: Radio },
  { href: "/dashboard",   label: "Stats",         icon: LayoutDashboard },
  { href: "/clients",     label: "Clients",       icon: Users },
  { href: "/plan-appel",  label: "Plan d'appel",  icon: ClipboardList },
  { href: "/products",    label: "Stock",         icon: Package },
  { href: "/entrees",     label: "Entrées",       icon: PackagePlus },
  { href: "/fabrication", label: "Fabrication",   icon: Factory },
  { href: "/commerciaux", label: "Commerciaux",   icon: Briefcase },
  { href: "/encours",     label: "Encours",       icon: Receipt },
];

export function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const initials = (session?.user?.name || session?.user?.email || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header
      className={`sticky top-0 z-50 h-[56px] transition-all duration-300 ${
        scrolled
          ? "bg-[#0b1018]/96 backdrop-blur-xl border-b border-white/[0.07] shadow-nav"
          : "bg-[#0b1018] border-b border-white/[0.06]"
      }`}
    >
      <div className="max-w-[1400px] mx-auto h-full flex items-center px-6 gap-6">
        {/* ── Logo — custom waveform mark (TeleVent = telephony + signal) ── */}
        <Link href="/console" className="flex items-center gap-2.5 shrink-0 group select-none">
          <div className="relative flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-gradient-to-br from-brand-500 to-brand-700 transition-all duration-300 group-hover:from-brand-400 group-hover:to-brand-600 group-hover:shadow-[0_0_16px_rgba(99,102,241,0.55)]">
            {/* Custom signal/voice waveform mark */}
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white" fill="none">
              <path d="M3 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M7 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M11 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M15 8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M19 11v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M21 12h0.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {/* Subtle live indicator dot */}
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-[#0b1018] animate-soft-pulse" />
          </div>
          <span className="text-[14px] font-semibold tracking-[-0.02em] text-white/90 group-hover:text-white transition-colors">
            Tele<span className="text-brand-400 italic font-light">Vent</span>
          </span>
        </Link>

        {/* ── Separator ────────────────────────── */}
        <div className="h-4 w-px bg-white/[0.1] shrink-0" />

        {/* ── Bandeau + bascule environnement SAP (anti-erreur test/prod) ── */}
        <SapEnvSwitch />

        {/* ── Nav links ────────────────────────── */}
        <nav className="flex items-center gap-0.5 flex-1">
          {NAV_LINKS.map(({ href, label }) => {
            const active =
              pathname === href ||
              (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`relative h-8 px-3 flex items-center rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  active
                    ? "text-white bg-white/[0.09]"
                    : "text-white/50 hover:text-white/80 hover:bg-white/[0.05]"
                }`}
              >
                {label}
                {active && (
                  <span className="absolute bottom-[-15px] inset-x-2 h-[2px] rounded-t-full bg-brand-500" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* ── Right actions ────────────────────── */}
        <ColorimetrieSwitcher />
        <ThemeToggle />
        <div className="h-4 w-px bg-white/[0.08] shrink-0" />
        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors group focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500">
                {/* Avatar */}
                <div className="h-[26px] w-[26px] rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shadow-[0_0_0_2px_rgba(99,102,241,0.25)] shrink-0">
                  {initials}
                </div>
                <span className="hidden sm:block text-[13px] text-white/60 max-w-[110px] truncate group-hover:text-white/80 transition-colors">
                  {session.user.name?.split(" ")[0] || session.user.email?.split("@")[0]}
                </span>
                <ChevronDown className="h-3 w-3 text-white/30 group-hover:text-white/50 transition-colors hidden sm:block" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-58 mt-2 rounded-xl border-white/[0.08] dark:border-white/[0.06] bg-white dark:bg-[#16181f] shadow-modal p-1">
              <div className="px-3 py-2.5">
                <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-none">
                  {session.user.name}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 truncate">
                  {session.user.email}
                </p>
              </div>
              <DropdownMenuSeparator className="my-1 dark:bg-white/[0.06]" />
              <DropdownMenuItem
                className="text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-300 focus:bg-rose-50 dark:focus:bg-rose-900/20 cursor-pointer rounded-lg text-[13px] gap-2"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-3.5 w-3.5" />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
