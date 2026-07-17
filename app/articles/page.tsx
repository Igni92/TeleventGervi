import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArticlesTable } from "@/components/articles/ArticlesTable";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Articles" };
export const dynamic = "force-dynamic";

export default async function ArticlesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-up">
      <PageHeader
        kicker="Catalogue SAP B1"
        title="Fiches articles"
        help={
          <>
            Toutes les infos SAP de chaque article, <b>modifiables</b> : conditionnement
            (achat / vente / stockage), calibre, EAN13, marque, pays, variété, poids…
            Ouvrez une fiche pour éditer (écriture SAP), consulter le <b>dernier prix
            d&apos;achat</b>, le <b>stock</b> et les <b>lots</b>.
          </>
        }
      />
      <ArticlesTable />
    </div>
  );
}
