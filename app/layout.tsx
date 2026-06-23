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
  title: { default: "TeleVent", template: "%s | TeleVent" },
  description: "Application de gestion télévente professionnelle",
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
        {/* Anti-FOUC : applique colorimétrie + densité choisies avant le 1er paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement;var t=localStorage.getItem('televent-theme');if(t&&t!=='or'){r.setAttribute('data-theme',t);}var d=localStorage.getItem('televente:ecran2Density');if(d==='compact'||d==='aere'){r.setAttribute('data-density',d);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <AmbientBackground />
        <Providers>
          {children}
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
