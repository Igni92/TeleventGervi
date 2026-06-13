import { AppLayout } from "@/components/AppLayout";

/** Accueil — chrome applicatif standard (sidebar + zone de contenu). */
export default function AccueilLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
