import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

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
  const publicRoutes = ["/login", "/api/auth", "/api/diag"];
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
