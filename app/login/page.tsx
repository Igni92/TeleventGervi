import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginButton } from "./LoginButton";
import { ComptaLogin } from "./ComptaLogin";
import { Shield, Zap, BarChart2 } from "lucide-react";

export const metadata = { title: "Connexion | Gervi" };

const FEATURES = [
  { icon: Zap,        text: "Suivi appels en temps réel" },
  { icon: BarChart2,  text: "Dashboard & statistiques" },
  { icon: Shield,     text: "SSO sécurisé Microsoft 365" },
];

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/console");

  return (
    <div className="min-h-screen bg-[#08090E] flex items-center justify-center p-4 relative overflow-hidden">

      {/* ── Ambiance apaisée : une seule nappe de teinte marque ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="ambient-aurora" />
      </div>

      {/* ── Card ──────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-[420px] animate-fade-up">
        <div
          className="rounded-2xl border border-white/[0.08] p-8"
          style={{
            background:
              "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
            backdropFilter: "blur(20px)",
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* Logo */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-2xl opacity-30 scale-125" style={{ background: "#F4006C" }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="Gervi" className="relative h-20 w-20 object-contain drop-shadow-[0_4px_20px_rgba(244,0,108,0.35)]" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Gerv<span className="text-brand-400">i</span>
              </h1>
              <p className="text-white/40 text-sm mt-1">
                Gestion télévente professionnelle
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="mb-7 space-y-2.5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2.5">
                <div className="h-5 w-5 rounded-md bg-brand-600/20 flex items-center justify-center shrink-0">
                  <Icon className="h-3 w-3 text-brand-400" />
                </div>
                <span className="text-[13px] text-white/50">{text}</span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-white/[0.07] mb-6" />

          {/* Login */}
          <LoginButton />

          {/* Cabinet comptable : boîte partagée sans SSO → mot de passe dédié. */}
          <ComptaLogin />

          <p className="text-center text-[11px] text-white/25 mt-4 leading-relaxed">
            Accès réservé à l&apos;équipe commerciale.<br />
            Authentification sécurisée via Microsoft Azure AD.
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-white/20 text-[11px] mt-5">
          &copy; {new Date().getFullYear()} Gervi — Tous droits réservés
        </p>
      </div>
    </div>
  );
}
