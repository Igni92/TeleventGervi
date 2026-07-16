import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PromosManager } from "@/components/promos/PromosManager";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Promos" };
export const dynamic = "force-dynamic";

export default async function PromosPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        kicker="Animation commerciale · Console Écran 2"
        title="Promos"
        help={
          <>
            Les promos <b>actives</b> s&apos;affichent en badge sur la liste stock de
            l&apos;Écran 2, préremplissent la remise à l&apos;ajout au panier
            (remise % ou colis offerts) et sont mentionnées en en-tête du bon SAP.
          </>
        }
      />
      <PromosManager />
    </div>
  );
}
