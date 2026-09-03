import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { EmployeeHome } from "@/components/rh/EmployeeHome";

export const metadata = { title: "Mon espace RH" };
export const dynamic = "force-dynamic";

/**
 * Espace salarié RH V2 — BADGEUSE + compteurs. Masqué tant que le flag RH_V2
 * n'est pas activé (bascule progressive ; le RH actuel reste la référence).
 * Accessible à TOUS les salariés connectés (self-service).
 */
export default async function RhPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  return <EmployeeHome />;
}
