import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Clock3, ShieldCheck, UserCog } from "lucide-react";
import { SignOutLink } from "./SignOutLink";

export const metadata = { title: "Bienvenue | Gervi" };
export const dynamic = "force-dynamic";

/**
 * ÉCRAN DE BIENVENUE — seul écran atteignable par un compte connecté à qui
 * AUCUN rôle n'a encore été attribué (cf. lib/auth `provisioned` + proxy.ts).
 *
 * Se connecter ne demande qu'une adresse @gervifrais.com : une recrue obtient
 * donc une session dès son premier login, avant que quiconque ne l'ait
 * habilitée. Plutôt qu'un « accès refusé » sec — anxiogène et illisible pour
 * quelqu'un dont c'est le premier jour — on explique où il en est : le compte
 * est bien créé, il ne manque que l'attribution d'un rôle.
 */
export default async function BienvenuePage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Compte habilité entre-temps : le middleware redirige déjà, ce garde-fou
  // couvre l'accès direct au rendu (build, lien mis en favori).
  if (session.user?.provisioned !== false) redirect("/clients");

  const prenom = (session.user?.name ?? "").trim().split(/\s+/)[0] || null;

  return (
    <div className="min-h-screen bg-[#08090E] flex items-center justify-center p-4 relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="ambient-aurora" />
      </div>

      <div className="relative z-10 w-full max-w-[460px] animate-fade-up">
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
          <div className="flex flex-col items-center gap-4 mb-7">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-2xl opacity-30 scale-125" style={{ background: "#F4006C" }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="Gervi" className="relative h-16 w-16 object-contain drop-shadow-[0_4px_20px_rgba(244,0,108,0.35)]" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Bienvenue{prenom ? <> chez Gerv<span className="text-brand-400">i</span>, {prenom}</> : <> chez Gerv<span className="text-brand-400">i</span></>} !
              </h1>
              <p className="text-white/50 text-[13.5px] mt-2 leading-relaxed">
                Ton compte est bien créé. Il ne reste qu&apos;une étape :
                un administrateur doit t&apos;attribuer ton rôle pour ouvrir
                les écrans qui te concernent.
              </p>
            </div>
          </div>

          <div className="border-t border-white/[0.07] mb-6" />

          <div className="space-y-3">
            <Step icon={ShieldCheck} title="Connexion validée"
              text={session.user?.email ?? "Compte Microsoft 365 vérifié"} done />
            <Step icon={UserCog} title="Attribution du rôle"
              text="En attente d'un administrateur (Effectifs › Équipe Gervi)" />
            <Step icon={Clock3} title="Accès à l'application"
              text="Ouvert automatiquement, sans avoir à te reconnecter" />
          </div>

          <p className="text-center text-[11.5px] text-white/30 mt-6 leading-relaxed">
            Une fois ton rôle attribué, l&apos;accès s&apos;ouvre en quelques
            minutes — il suffit de rafraîchir cette page.
          </p>

          <div className="mt-5 flex justify-center">
            <SignOutLink />
          </div>
        </div>

        <p className="text-center text-white/20 text-[11px] mt-5">
          &copy; {new Date().getFullYear()} Gervi — Tous droits réservés
        </p>
      </div>
    </div>
  );
}

function Step({
  icon: Icon, title, text, done,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string; text: string; done?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
        done ? "bg-emerald-500/15" : "bg-white/[0.06]"
      }`}>
        <Icon className={`h-3.5 w-3.5 ${done ? "text-emerald-400" : "text-white/40"}`} />
      </div>
      <div className="min-w-0">
        <p className={`text-[13px] font-semibold ${done ? "text-white/85" : "text-white/70"}`}>{title}</p>
        <p className="text-[12px] text-white/35 break-words">{text}</p>
      </div>
    </div>
  );
}
