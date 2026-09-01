import { FeuilleRoute } from "@/components/transport/FeuilleRoute";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feuille de route — Gervifrais" };

// Page PUBLIQUE (chauffeur sans compte) — accès garanti par le token (cf. proxy.ts).
export default async function FeuilleRoutePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return <FeuilleRoute token={token} />;
}
