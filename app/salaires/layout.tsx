import { AppLayout } from "@/components/AppLayout";

/**
 * Layout /salaires — le CHROME APPLICATIF standard (sidebar + barre mobile +
 * gouttières). Réservé à l'équipe admin/direction (cf. la page ci-dessous) :
 * le cabinet comptable ne se connecte plus, il reçoit les documents par mail.
 */
export default function SalairesLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
