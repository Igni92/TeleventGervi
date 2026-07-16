import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Encours } from "@/components/encours/Encours";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Encours" };
export const dynamic = "force-dynamic";

export default async function EncoursPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        kicker="Comptabilité · base réelle"
        title="État des encours"
        help={
          <>
            Dû <b>net</b> par client (factures ouvertes <b>moins l&apos;encaissé non affecté</b> —
            solde du compte tiers). Ouvrez un client puis <b>Relancer</b> pour générer et
            envoyer un courrier de relance (R0→R5, modèles NT-2026-RC-01).
          </>
        }
      />
      <Encours />
    </div>
  );
}
