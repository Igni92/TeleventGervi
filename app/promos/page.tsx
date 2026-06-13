import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PromosManager } from "@/components/promos/PromosManager";

export const metadata = { title: "Promos" };
export const dynamic = "force-dynamic";

export default async function PromosPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-8 animate-fade-up">
      <div>
        <p className="kicker mb-2">Animation commerciale · Console Écran 2</p>
        <h1 className="text-[32px] font-bold text-foreground tracking-tight leading-none">
          Promos
        </h1>
        <p className="text-[13px] text-muted-foreground mt-3 max-w-2xl">
          Les promos <b>actives</b> s&apos;affichent en badge sur la liste stock de
          l&apos;Écran 2, préremplissent la remise à l&apos;ajout au panier
          (remise % ou colis offerts) et sont mentionnées en en-tête du bon SAP.
        </p>
      </div>
      <PromosManager />
    </div>
  );
}
