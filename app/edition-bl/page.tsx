import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { EditionBlPanel } from "@/components/bl/EditionBlPanel";
import { isRestrictedPreparateur } from "@/lib/preparateur";
import { isLivreur } from "@/lib/permissions";

export const metadata = { title: "Édition BL" };
export const dynamic = "force-dynamic";

export default async function EditionBlPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Document COMMERCIAL (prix sur chaque ligne) : les rôles restreints
  // (préparateur verrouillé, livreur) n'y ont pas accès — même règle que
  // l'API /api/bl-edition.
  const restricted = isRestrictedPreparateur(session.user?.email) || (await isLivreur(session));
  if (restricted) redirect("/livraisons");

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Télévente</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Édition BL
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Tous les <b>bons de livraison SAP</b> d&apos;une <b>date de livraison</b>, imprimés au
          <b> format officiel</b> (réplique de l&apos;édition SAP/coresuite : code-barres, lots,
          prix, taxes parafiscales). Filtre par segment <b>GMS / CHR / Export</b>, impression
          groupée en un seul job.
        </p>
      </header>
      <EditionBlPanel />
    </div>
  );
}
