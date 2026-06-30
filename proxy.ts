import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isRestrictedPreparateur } from "@/lib/preparateur";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // ⚠️ MODE TEST (préversion uniquement) : on laisse tout passer, le login
  // Microsoft est court-circuité. JAMAIS en production. À retirer après tests.
  if (process.env.VERCEL_ENV === "preview") {
    return NextResponse.next();
  }

  // Origine RÉELLE de la requête derrière le proxy Vercel. On n'utilise pas
  // req.url (ni NEXTAUTH_URL) qui peut pointer vers http://localhost:3000 si la
  // variable d'env a été écrasée — x-forwarded-host/proto reflètent toujours le
  // vrai domaine de prod. Évite les redirections vers localhost.
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "") ?? "https";
  const origin = `${proto}://${host}`;

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/api/auth"];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  if (!req.auth && !isPublicRoute) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from login page
  if (req.auth && pathname === "/login") {
    return NextResponse.redirect(new URL("/clients", origin));
  }

  // RÔLE PRÉPARATEUR : accès restreint à ses écrans de PRÉPARATION — le Détail
  // livraison (préparation de commande) ET l'Inventaire (comptage du stock).
  // Tout autre chemin applicatif est renvoyé vers le Détail livraison (écran
  // principal de préparation). Les routes /api et les assets restent
  // accessibles pour que les pages fonctionnent.
  if (isRestrictedPreparateur(req.auth?.user?.email)) {
    const allowed = pathname.startsWith("/livraisons")
      || pathname.startsWith("/inventaire")
      || pathname.startsWith("/api")
      || pathname.startsWith("/login");
    if (!allowed) {
      return NextResponse.redirect(new URL("/livraisons", origin));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
