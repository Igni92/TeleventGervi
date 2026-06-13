/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["graph.microsoft.com"],
  },
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
};

export default nextConfig;
