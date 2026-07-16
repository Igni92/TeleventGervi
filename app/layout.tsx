import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AppToaster } from "@/components/ui/toaster";
import { ClickSparks } from "@/components/ClickSparks";
import { SaleCelebration } from "@/components/SaleCelebration";
import { Providers } from "./providers";
import { AmbientBackground } from "@/components/AmbientBackground";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

// Inter = texte courant (lisibilité max). Space Grotesk = DISPLAY : titres et
// gros chiffres. Sa personnalité géométrique-industrielle colle à l'identité
// anthracite + jaune, et sort l'app du « tout-Inter » générique. Il embarque
// les chiffres tabulaires (tnum) → aucun saut de layout sur les KPI animés.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Gervi · Télévente", template: "%s · Gervi" },
  description: "Gervi — CRM de télévente du grossiste en fruits frais.",
  robots: "noindex, nofollow",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Gervi", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b1018",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <head>
        {/* Anti-FOUC : applique densité + zoom d'interface avant le 1er paint.
            Colorimétrie retirée (marque = Or unique) → on purge un ancien choix.
            + Détection APPAREIL TACTILE (téléphone/tablette) → data-ui="touch"
            sur <html>, consommé par la variante Tailwind `touch:` (coquille
            mobile forcée). Trois signaux combinés : pointer:coarse (vrai
            appareil tactile), maxTouchPoints (iPadOS en UA desktop, DevTools)
            et user-agent (émulateurs d'appareil qui ne posent que l'UA). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement;try{if(localStorage.getItem('televent-theme'))localStorage.removeItem('televent-theme');}catch(e){}var d=localStorage.getItem('televente:ecran2Density');if(d==='compact'||d==='aere'){r.setAttribute('data-density',d);}var z=localStorage.getItem('televente:uiZoom');if(z==='110'||z==='125'||z==='140'){r.style.setProperty('--app-zoom',String(Number(z)/100));}var ap=localStorage.getItem('televente:accentPos');if(ap==='top'||ap==='bottom'||ap==='off'){r.setAttribute('data-accent-pos',ap);}var n=navigator;if((window.matchMedia&&matchMedia('(pointer: coarse)').matches)||(n.maxTouchPoints||0)>1||/Android|iPhone|iPad|iPod|Mobi|Tablet/i.test(n.userAgent||'')){r.setAttribute('data-ui','touch');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <AmbientBackground />
        <Providers>
          {/* Wrapper de ZOOM d'interface (confort visuel Direction) : agrandit le
              contenu applicatif sans toucher au fond d'ambiance fixe. */}
          <div className="app-zoom-root">{children}</div>
          <AppToaster />
          <ClickSparks />
          <SaleCelebration />
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
