import Link from "next/link";
import { X } from "lucide-react";
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
    <div className="space-y-6 animate-fade-up px-1 sm:px-2">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          kicker="Pilotage"
          title="État documentaire"
          help={<>Tous les documents archivés (BL, factures, avoirs) récupérés de la boîte <b>factures-archive@</b>.<br/>Rangés par client, en dossiers BL → Facture → Avoir. Cliquez une case pour l&apos;aperçu.</>}
        />
        <Link
          href="/accueil"
          className="shrink-0 mt-1 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          title="Quitter l'état documentaire"
        >
          <X className="h-4 w-4" /> Quitter
        </Link>
      </div>
      <DocumentsExplorer />
    </div>
  );
}
