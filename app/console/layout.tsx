import { Sidebar } from "@/components/Sidebar";

/**
 * Console gets a wider container than the rest of the app —
 * the 3-pane workspace needs horizontal real estate to feel breathable.
 * Locked to viewport height so only the inner columns scroll, not the page.
 * Sidebar gauche (mode rail conseillé ici — persisté localStorage).
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen transition-colors duration-300 flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-h-0 min-w-0 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-10 py-6 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
