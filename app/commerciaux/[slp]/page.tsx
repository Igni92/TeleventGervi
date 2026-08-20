import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAccessScope, UNMAPPED_MESSAGE } from "@/lib/permissions";
import { Banner } from "@/components/ui/banner";
import { FicheCommercial } from "./FicheCommercial";

export const metadata = { title: "Fiche commercial | Gervi" };
export const dynamic = "force-dynamic";

/**
 * Fiche commercial SAP — /commerciaux/[slp].
 * Droits : un non-admin ne peut voir QUE sa propre fiche (redirect sinon) ;
 * compte non mappé → message explicite. Les admins voient tout.
 */
export default async function FicheCommercialPage(props: { params: Promise<{ slp: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) redirect("/login");

  const slp = decodeURIComponent(params.slp).trim();
  const scope = await getAccessScope(session);

  if (!scope.all) {
    if (!scope.slpName) {
      return (
        <div className="max-w-xl mx-auto mt-16 animate-fade-up">
          <Banner tone="warning" title="Accès restreint">{UNMAPPED_MESSAGE}</Banner>
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
