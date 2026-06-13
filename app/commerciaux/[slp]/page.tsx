import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getAccessScope, UNMAPPED_MESSAGE } from "@/lib/permissions";
import { FicheCommercial } from "./FicheCommercial";

export const metadata = { title: "Fiche commercial | TeleVent" };
export const dynamic = "force-dynamic";

/**
 * Fiche commercial SAP — /commerciaux/[slp].
 * Droits : un non-admin ne peut voir QUE sa propre fiche (redirect sinon) ;
 * compte non mappé → message explicite. Les admins voient tout.
 */
export default async function FicheCommercialPage({ params }: { params: { slp: string } }) {
  const session = await auth();
  if (!session) redirect("/login");

  const slp = decodeURIComponent(params.slp).trim();
  const scope = await getAccessScope(session);

  if (!scope.all) {
    if (!scope.slpName) {
      return (
        <div className="max-w-xl mx-auto mt-16 flex items-start gap-3 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-5 py-4 animate-fade-up">
          <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-amber-800 dark:text-amber-300">Accès restreint</p>
            <p className="text-[12.5px] text-amber-700/90 dark:text-amber-400/90 mt-1">{UNMAPPED_MESSAGE}</p>
          </div>
        </div>
      );
    }
    if (scope.slpName !== slp) {
      // Un commercial ne consulte que SA fiche.
      redirect(`/commerciaux/${encodeURIComponent(scope.slpName)}`);
    }
  }

  return <FicheCommercial slp={slp} />;
}
