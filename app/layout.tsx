import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import { AmbientBackground } from "@/components/AmbientBackground";

// One sans for everything — Inter is screen-engineered for max legibility.
// "Premium" comes from spacing, hierarchy, and restraint — not font swaps.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: { default: "Gervi · Télévente", template: "%s · Gervi" },
  description: "Gervi — CRM de télévente du grossiste en fruits frais.",
  robots: "noindex, nofollow",
};

export const viewport: Viewport = {
  themeColor: "#0b1018",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <head>
        {/* Anti-FOUC : applique densité + zoom d'interface avant le 1er paint.
            Colorimétrie retirée (marque = Or unique) → on purge un ancien choix. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement;try{if(localStorage.getItem('televent-theme'))localStorage.removeItem('televent-theme');}catch(e){}var d=localStorage.getItem('televente:ecran2Density');if(d==='compact'||d==='aere'){r.setAttribute('data-density',d);}var z=localStorage.getItem('televente:uiZoom');if(z==='110'||z==='125'||z==='140'){r.style.setProperty('--app-zoom',String(Number(z)/100));}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <AmbientBackground />
        <Providers>
          {/* Wrapper de ZOOM d'interface (confort visuel Direction) : agrandit le
              contenu applicatif sans toucher au fond d'ambiance fixe. */}
          <div className="app-zoom-root">{children}</div>
          <Toaster
            richColors
            position="top-right"
            toastOptions={{
              style: { fontFamily: "var(--font-inter, Inter, sans-serif)" },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
