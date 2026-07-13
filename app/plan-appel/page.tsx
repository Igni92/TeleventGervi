import { redirect } from "next/navigation";

export const metadata = { title: "Plan d'appel" };

/**
 * /plan-appel — FUSIONNÉ dans « Clients & plan d'appel » (/clients). L'ancien
 * cockpit d'assignation et l'annuaire clients affichaient la même population
 * sous deux angles quasi identiques : ils ne forment plus qu'UNE liste. On garde
 * l'URL adressable (deep-links, mémoire spatiale, palette ⌘K) via une redirection.
 */
export default function PlanAppelPage() {
  redirect("/clients");
}
