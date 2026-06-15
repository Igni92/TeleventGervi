/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["graph.microsoft.com"],
  },
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
  // En-têtes de sécurité de base (sans CSP — évite de casser les scripts inline
  // de Next ; à durcir séparément si besoin). Appliqués à toutes les routes.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
