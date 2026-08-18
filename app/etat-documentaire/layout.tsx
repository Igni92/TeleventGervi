import { AppLayout } from "@/components/AppLayout";

/** Même correctif que /prospection : la route n'avait pas de layout, donc pas
 *  de barre latérale — cf. app/prospection/layout.tsx. */
export default function EtatDocumentaireLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
