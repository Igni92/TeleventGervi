/**
 * Layout /dashboard — **plein écran sans chrome app** (pas de Navbar, pas de
 * sidebar). Le cockpit doit occuper 1920×1080 pile, viewport-aware.
 *
 * Note : remplace l'ancien DashboardLayout (AppLayout + DashboardTabs) par
 * un viewport h-screen overflow-hidden. Conséquence : la Navbar du reste
 * de l'app ne s'affiche pas sur /dashboard — c'est intentionnel (mode cockpit).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden text-foreground">
      {children}
    </div>
  );
}
