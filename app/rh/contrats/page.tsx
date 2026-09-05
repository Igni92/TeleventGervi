import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Fusionné dans le Cockpit RH & contrats (/rh/direction). Redirection permanente. */
export default function RhContratsPage() {
  redirect("/rh/direction");
}
