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

  // ── RÔLES À ACCÈS RESTREINT (terrain) : préparateur, livreur, agréeur ──
  // Un compte peut CUMULER ces rôles → son périmètre est l'UNION des écrans de
  // chacun (un préparateur-agréeur atteint SES écrans de prépa ET les commandes
  // fournisseurs / entrées pour agréer). Tant qu'il porte AU MOINS un rôle
  // restreint, tout chemin hors de cette union est renvoyé vers son écran
  // principal. Aucun rôle restreint → accès complet (admin, direction, commercial).
  //   • préparateur restreint (email, cf. lib/preparateur) → /livraisons, /inventaire
  //   • livreur (flag jeton) → /livraisons (marque « départ »), /clients (créneaux/GPS)
  //   • agréeur (flag jeton) → /commandes-fournisseurs, /entrees (réception CF → EM)
  // Les routes /api et /login restent toujours ouvertes (pages fonctionnelles).
  const isPrep = isRestrictedPreparateur(req.auth?.user?.email);
  const isLivreur = req.auth?.user?.isLivreur === true;
  const isAgreeur = req.auth?.user?.isAgreeur === true;
  if (isPrep || isLivreur || isAgreeur) {
    // /heures : saisie PERSONNELLE des heures — ouverte à tout rôle confiné
    // (chacun enregistre SA semaine). /planning : congés & récup (demandes +
    // réponses aux propositions de la direction) — même ouverture. /api +
    // /login toujours accessibles.
    const allowedPrefixes = ["/api", "/login", "/heures", "/planning"];
    if (isPrep) allowedPrefixes.push("/livraisons", "/inventaire", "/preparations");
    if (isLivreur) allowedPrefixes.push("/livraisons", "/clients");
    if (isAgreeur) allowedPrefixes.push("/commandes-fournisseurs", "/entrees");
    const allowed = allowedPrefixes.some((p) => pathname.startsWith(p));
    if (!allowed) {
      // Écran d'atterrissage : la prépa/livraison si terrain, sinon les commandes
      // fournisseurs (poste de l'agréeur « pur »).
      const home = isPrep || isLivreur ? "/livraisons" : "/commandes-fournisseurs";
      return NextResponse.redirect(new URL(home, origin));
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
     * - sw.js + manifest.webmanifest : fichiers PWA que le navigateur récupère
     *   SOUVENT SANS cookie (donc sans session) → l'auth les redirigeait vers
     *   /login, cassant l'installation (Android : simple raccourci « G » au lieu
     *   d'installer l'app) et l'enregistrement du service worker. Ils ne
     *   contiennent aucune donnée sensible → toujours publics.
     * - fichiers statiques (images, icônes, json, txt).
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|webmanifest)$).*)",
  ],
};
