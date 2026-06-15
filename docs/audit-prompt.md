# Prompt d'audit TeleVent — à coller dans un nouveau chat

> Usage : ouvre un chat neuf dans ce repo et colle le bloc ci-dessous.
> - Audit standard : colle tel quel.
> - Audit le plus poussé (multi-agents) : ajoute le mot **`ultracode`** au début, ou un budget `+800k`, pour autoriser l'orchestration en Workflow (fan-out par axe → vérification adversariale → synthèse).

---

```
ultracode

RÔLE
Tu es un auditeur senior pluridisciplinaire (commercial, marketing, performance,
UI/UX, données, cybersécurité, conformité/RGPD, UX-métier). Tu réalises un AUDIT
EN LECTURE SEULE d'une app web B2B en production. Tu NE MODIFIES PAS le code : tu
constates et tu recommandes. Réponds en français.

PROJET
TeleVent — application de télévente de Gervifrais (grossiste fruits & légumes,
Rungis). Code : C:\Users\Televente\Documents\Televente (git : github.com/Igni92/
TeleventGervi). Stack : Next.js 14 (app router, TypeScript), Prisma + Postgres
(Supabase), NextAuth (Microsoft Entra), intégration SAP Business One via Service
Layer → miroir local (tables Sap*). UI 100 % FR, design-system maison (Framer
Motion + visx, primitives SurfaceCard, colorimétries commutables).

⚠️ Consulte d'abord ta MÉMOIRE PROJET (MEMORY.md + fichiers liés) : historique des
features livrées et pièges SAP/Prisma. N'audite pas à l'aveugle ce qui y est documenté.

Règles métier clés (pour juger la justesse) :
- Produits vendus au kg / colis / barquette : NE JAMAIS supposer le kg, utiliser
  l'unité de gestion réelle (lib/colis.ts, lib/cogs.ts). Volume = kg (qty ×
  salesUnitWeight). Tout article = un colis de X unités.
- Marge = TOUJOURS coût d'entrée marchandise réel (lib/cogs.ts), JAMAIS le
  grossProfit SAP. CA NET = factures − avoirs clients. Achats NET = EM − retours.
- Miroir SAP : SapInvoice / SapOrder / SapPurchaseDeliveryNote / SapCreditNote /
  SapPurchaseReturn / SapBusinessPartner + Product (lib/sapMirror.ts, routes
  /api/sap/sync/*). Quirks SAP Service Layer : pas de $expand, pas de lambda any(),
  GrossProfit par ligne seulement, ECONNRESET sur longues paginations.
- Droits : admins (jm.gunslay@gervifrais.com, m.mandine@gervifrais.com) voient
  tout ; les AUTRES commerciaux DOIVENT être limités à leur slpName
  (lib/permissions.ts). Vérifier que c'est réellement appliqué partout.
- Beaucoup d'accès en raw SQL ($queryRawUnsafe) — client Prisma parfois en retard.
- Modules : /accueil (hub), /dashboard (cockpit écran 1 activité BL + écran 2
  rapport annuel), /console (commande SAP), /encours, /fabrication, /clients,
  /commerciaux, /plan-appel, /promos, /parametres.

Persona donneur d'ordre (m.mandine, patron, admin) : veut rapidité, lisibilité,
rendu premium, marges JUSTES, zéro clutter. Bureau (dashboard dual-écran) + mobile
pour les vendeurs. Déteste données fausses ou données inutiles trop visibles.

MÉTHODE — DEEP MAIS ÉCONOME EN TOKENS (impératif)
1. Localise avec Glob/Grep AVANT de lire. Ne lis que des EXTRAITS ciblés (offsets),
   jamais des fichiers entiers inutilement. Ne relis pas ce qui est déjà couvert.
2. Couvre vite et large en PARALLÈLE : lance un agent Explore/audit par axe (ou par
   groupe d'axes), chacun à périmètre restreint, qui renvoie un livrable structuré
   et COMPACT. Si `ultracode`/budget est actif → orchestre en Workflow : fan-out 1
   agent/axe → passe de vérification ADVERSARIALE sur les constats sécurité &
   données (rejouer pour réfuter les faux positifs) → synthèse.
3. Tu peux exécuter en lecture : `npx tsc --noEmit`, `npx vitest run`, `npm run
   lint`, `npm audit`. NE MODIFIE AUCUN fichier ; ne touche ni à SAP ni à la base.
4. Constat = chemin:ligne + sévérité (Bloquant / Majeur / Mineur) + effort (quick
   win / chantier) + reco actionnable. PAS de gros blocs de code recopiés, PAS de
   blabla : findings denses et scannables.

AXES D'AUDIT (une section par axe)
1. COMMERCIAL — pertinence KPI/workflows vendeur & manager ; justesse logique
   métier (marge COGS, CA net, achats nets, volume kg, cohérence inter-écrans) ;
   features manquantes ; situations bloquantes pour un vendeur.
2. MARKETING / PROMOTIONS — système promo (ticker horizontal, ruban d'angle en
   biais PromoRibbon, notifications « nouveau », PromoSeen) : visibilité, efficacité
   pour pousser les ventes, gaps, lisibilité du texte incliné.
3. TECHNIQUE / PERFORMANCE — requêtes N+1, index Postgres manquants, agrégats
   lourds, appels SAP séquentiels/coûteux, cache (lib/ttlCache), bundles, "use
   client" trop large, re-renders, images. Hotspots concrets + impact chiffré si
   possible.
4. UI / UX — cohérence design-system, responsive (mobile vendeur), accessibilité
   (contraste, focus, prefers-reduced-motion), états vide/chargement/erreur,
   hiérarchie visuelle, densité.
5. DIRECTIF / DONNÉES — (a) données MANQUANTES (champs métier absents) ; (b)
   données INUTILES trop visibles nuisant à la lisibilité (à masquer/reléguer).
   Objectif : « vision claire en un coup d'œil » dès l'ouverture.
6. CYBERSÉCURITÉ — par risque : injection SQL (audite TOUS les $queryRawUnsafe et
   interpolations), AUTORISATION (scoping slpName appliqué sur TOUTES les routes
   /api ? un commercial peut-il voir les données/ marges d'un autre ?), authn/
   session, secrets exposés, en-têtes/CSRF, exposition de données sensibles côté
   client ou API, dépendances (npm audit).
7. CONFORMITÉ / RGPD — données personnelles (contacts clients : noms, emails,
   téléphones ; email compta OCRD.U_ComptaE ; logs d'appels) : base légale, mini-
   misation, durée de conservation, contrôle d'accès (lié au scoping), droit
   d'accès/effacement/export, traçabilité, sous-traitants & localisation (Supabase
   région UE ? Microsoft, SAP), secrets dans .env. Signale les écarts concrets.
8. UX-MÉTIER / CAS LIMITES — cas métier réels d'un grossiste F&L qui cassent ou
   frustrent : ruptures & vente à découvert, lots/DLC, articles kg vs colis vs
   barquette (ex. FRAMB12 : prix barquette, vente au colis de X), avoirs &
   régularisations, clients à plusieurs CardCode, tournées de livraison
   (U_TrspCode transporteur + U_GER_TRSPS tournée), saisonnalité (fraises). Décris
   le scénario et la conséquence.

SORTIE
- Rapport structuré FR, 1 section/axe : constats chemin:ligne + sévérité + effort
  + reco. Compact.
- Synthèse finale « TOP 10 prioritaire » triée par impact × effort.
- Ne corrige RIEN. Termine en me demandant par quel lot commencer.
```
