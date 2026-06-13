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
        <p className="text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Factures dues (non soldées) par client, avec le montant <b>en retard</b> et
          l&apos;ancienneté. Base d&apos;un futur système de <b>relance automatique</b>.
        </p>
      </header>
      <Encours />
    </div>
  );
}
