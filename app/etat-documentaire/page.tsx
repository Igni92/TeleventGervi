import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentsExplorer } from "@/components/documents/DocumentsExplorer";

export const metadata = { title: "État documentaire" };
export const dynamic = "force-dynamic";

export default async function EtatDocumentairePage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        kicker="Pilotage"
        title="État documentaire"
        help={<>Tous les documents archivés (BL, factures, avoirs) rangés par client, en dossiers BL → Facture → Avoir.<br/>Cliquez une case pour l&apos;aperçu ; passez en vue Kanban pour facturer ou créer un avoir (boutons explicites).</>}
      />
      <DocumentsExplorer />
    </div>
  );
}
