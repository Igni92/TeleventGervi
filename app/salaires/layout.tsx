import { auth } from "@/lib/auth";
import { requireAdmin, isComptable } from "@/lib/permissions";
import { AppLayout } from "@/components/AppLayout";

/**
 * Layout /salaires — le CHROME APPLICATIF standard (sidebar + barre mobile +
 * gouttières) pour l'équipe : sans ce fichier la page se rendait NUE (pas de
 * navigation, pas de marges — impossible de « revenir en arrière »).
 *
 * Exception : le CABINET COMPTABLE (profil confiné, sans navigation d'app)
 * reste en document plein écran — sa vue porte sa propre barre (Planning +
 * déconnexion), le chrome complet n'aurait que des liens qui rebondissent.
 */
export default async function SalairesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const canEdit = await requireAdmin(session);
  if (!canEdit && (await isComptable(session))) {
    return <div className="min-h-screen px-4 py-5 sm:px-8 sm:py-8">{children}</div>;
  }
  return <AppLayout>{children}</AppLayout>;
}
