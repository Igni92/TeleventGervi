import { AppLayout } from "@/components/AppLayout";

/**
 * Cette route n'avait AUCUN layout : elle s'affichait donc sans la coquille
 * applicative — pas de barre latérale, pas de barre du haut mobile. D'où
 * l'impression de « changer d'onglet » en ouvrant la prospection. Elle suit
 * maintenant la même coquille que les autres écrans.
 */
export default function ProspectionLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
