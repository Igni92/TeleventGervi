import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Encours } from "@/components/encours/Encours";

export const metadata = { title: "Encours" };
export const dynamic = "force-dynamic";

export default async function EncoursPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Comptabilité · base réelle</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          État des encours
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Dû <b>net</b> par client (factures ouvertes <b>moins l&apos;encaissé non affecté</b> —
          solde du compte tiers). Ouvrez un client puis <b>Relancer</b> pour générer et
          envoyer un courrier de relance (R0→R5, modèles NT-2026-RC-01).
        </p>
      </header>
      <Encours />
    </div>
  );
}
