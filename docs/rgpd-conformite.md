# Conformité RGPD — TeleVent (Gervifrais)

> Document de travail — amorce du programme RGPD (audit F24‑F27).
> Statut : **brouillon à valider par le métier / DPO**. Les points marqués
> **⚠️ À CONFIRMER** appellent une décision ou une vérification externe
> (juridique, hébergeur, direction).

TeleVent est une application de télévente B2B (grossiste Fruits & Légumes,
Rungis). Elle traite des données personnelles d'**interlocuteurs professionnels**
chez les clients (restaurateurs, GMS, CHR, export) : noms, fonctions, téléphones,
emails. Le contexte est strictement B2B : aucune donnée de consommateur final,
aucune donnée sensible (santé, opinions…), aucun profilage publicitaire.

---

## 1. Registre des traitements

| # | Traitement | Finalité | Données personnelles | Source | Destinataires |
|---|-----------|----------|----------------------|--------|---------------|
| T1 | **Prospection / relance télévente** | Contacter les clients pour prise de commande, relance, fidélisation | Nom, fonction, téléphone(s), email de l'interlocuteur (`Contact`, `Client.tel1/2/3`, `Client.email`) | Saisie commerciale + import SAP B1 | Commerciaux Gervifrais (scopés), admins |
| T2 | **Historique des appels (CRM)** | Tracer les échanges, planifier rappels, mesurer l'activité | Lien client + horodatage + note libre + type d'appel (`AppelLog`, `Rappel`) | Activité commerciale dans l'app | Commercial en charge, admins |
| T3 | **Comptabilité / facturation** | Émettre/relancer les factures, gérer les litiges | Email compta (`OCRD.U_ComptaE` → `Client.emailCompta`), email réception (`Client.emailReception`), adresse de facturation | Onglet Compta de la fiche / SAP | Compta, admins |
| T4 | **Rattachement compte ↔ commercial** | Authentification + cloisonnement des accès | Email professionnel `@gervifrais.com`, mapping `slpName` (`UserCommercial`, `User`, NextAuth `Account`/`Session`) | Microsoft Entra (SSO) | Système (auth), admins |

Données **mirroir SAP** (`SapBusinessPartner.email/phone`, `slpName` sur factures,
commandes, avoirs…) : cache local en lecture seule de la source SAP B1. La source
de vérité de ces traitements reste **SAP B1** ; TeleVent en est un sous‑traitement
technique. **⚠️ À CONFIRMER** : intégrer ce registre au registre global Gervifrais
(art. 30 RGPD), qui doit couvrir SAP comme traitement parent.

---

## 2. Base légale & principes

### Base légale
- **T1, T2, T4 — intérêt légitime** (art. 6.1.f) : démarchage et suivi commercial
  entre professionnels d'une relation d'affaires existante ou prospectée. En B2B,
  la prospection par email/téléphone vers des professionnels relève de l'intérêt
  légitime (cf. position CNIL prospection B2B), sous réserve d'information et de
  droit d'opposition.
- **T3 — exécution du contrat / obligation légale** (art. 6.1.b et 6.1.c) :
  facturation et conservation comptable obligatoires.

### Minimisation (art. 5.1.c)
- Ne stocker que les coordonnées **professionnelles** utiles à la relation
  commerciale. Pas de données personnelles privées (mobile perso, adresse perso…).
- Le champ `note`/`notes` (libre) ne doit **pas** contenir d'information sensible
  ou excessive sur une personne. **⚠️ À CONFIRMER** : ajouter un rappel UI + une
  revue périodique du contenu des notes.
- `Client.email` est **déprécié** (cf. schéma Prisma B7) au profit de
  `Contact.email` : finaliser la migration puis retirer le champ pour éviter une
  donnée dupliquée/obsolète.

### Exactitude (art. 5.1.d)
- Bidirectionnalité SAP sur l'email client (`PUT /api/clients/[id]`) : maintenir
  l'exactitude entre TeleVent et SAP.

---

## 3. Durées de rétention (proposées)

| Donnée | Rétention proposée | Justification |
|--------|--------------------|---------------|
| Contacts & coordonnées (`Contact`, `Client.tel*`, emails) | **Tant que la relation commerciale est active + 3 ans** après le dernier contact/commande | Durée usuelle CNIL prospection ; au‑delà → anonymisation ou suppression |
| Historique d'appels CRM (`AppelLog`) | **24 à 36 mois** glissants | Suivi d'activité et saisonnalité (cycles annuels F&L) ; au‑delà l'intérêt opérationnel décroît |
| Rappels (`Rappel`) | Purge **12 mois** après statut `FAIT`/`ANNULE` | Donnée opérationnelle court terme |
| Données compta (`emailCompta`, facturation) | Aligné sur l'**obligation comptable / fiscale** (typiquement 10 ans pièces comptables) | Obligation légale — **⚠️ À CONFIRMER** avec la compta/expert‑comptable |
| Sessions / tokens auth (`Session`, `Account`, `VerificationToken`) | Expiration native NextAuth + purge des sessions expirées | Sécurité |
| Mirror SAP local | Aligné sur la rétention SAP B1 (cache, non autoritaire) | La source SAP gouverne |

**⚠️ À CONFIRMER (métier/DPO)** : valider chaque durée. Les valeurs ci‑dessus sont
des **propositions**. Aucune purge automatique n'est implémentée à ce stade
(cf. §6 effacement).

---

## 4. Sous‑traitants & localisation des données

| Sous‑traitant | Rôle | Données | Localisation | À vérifier |
|---------------|------|---------|--------------|-----------|
| **Supabase** (Postgres managé) | Hébergement de la base applicative | Toutes les données personnelles TeleVent | **⚠️ Région UE à confirmer** (ex. `eu-west-*` / Francfort / Paris). Vérifier dans la console Supabase > Project Settings > région du projet | DPA signé ? Région UE ? Chiffrement au repos ? |
| **Microsoft** (Entra ID / Graph) | SSO / authentification, Calendars.ReadWrite | Email pro, identité, jetons OAuth | UE (tenant Microsoft 365 Gervifrais) — **⚠️ confirmer la région du tenant** | DPA Microsoft (couvert par les CGU M365). Scope Graph minimal ? |
| **SAP B1** | Source ERP (clients, factures, commercial) | Données BP, compta, commercial | **⚠️ À confirmer** (on‑premise Gervifrais ? hébergé ? région ?) | Localisation de l'instance SAP, responsable du registre parent |

Points transverses **⚠️ À CONFIRMER** :
- Région d'hébergement Supabase **strictement UE** (impératif pour éviter transfert
  hors UE sans garanties).
- Existence et signature des **accords de sous‑traitance (DPA, art. 28)** avec
  Supabase, Microsoft, et tout prestataire d'infra (Vercel/host de l'app si
  applicable — **⚠️ vérifier où l'app Next.js est déployée**).
- Aucun transfert hors UE non encadré (clauses contractuelles types le cas échéant).

---

## 5. Cloisonnement des accès (lien avec `slpName`)

L'accès aux données personnelles est **cloisonné par commercial** (principe de
minimisation d'accès) :

- Un commercial connecté est rattaché à un `slpName` SAP via la table
  `UserCommercial` (email → slpName), résolu par `getAccessScope()`
  (`lib/permissions.ts`).
- Un commercial **ne voit que ses clients** : filtre
  `commercial = slpName OR vendeur = slpName` (cf. `app/api/clients/route.ts`).
- Un compte **non mappé** n'accède à **aucune** donnée (listes vides + message
  `UNMAPPED_MESSAGE`).
- Les **admins** (`ADMIN_EMAILS` dans `lib/permissions.ts`) ont un accès global
  (`scope.all === true`) — réservé à l'administration et aux demandes RGPD.
- La connexion est restreinte au domaine `@gervifrais.com` (callback `signIn`,
  `lib/auth.ts`).

Ce cloisonnement constitue une mesure technique de **minimisation des accès**
(art. 5.1.f sécurité / art. 25 protection par défaut).

---

## 6. Procédures « droits des personnes »

### 6.1 Droit d'accès & portabilité (art. 15 / 20)
Endpoint d'export implémenté : **`GET /api/rgpd/export?cardCode=...`**
(ou `?clientId=...`), **réservé aux admins**. Il rassemble en JSON, pour **un seul
client**, les données personnelles **déjà stockées** dans TeleVent :
- fiche client (nom, type, commercial, téléphones, email),
- emails compta / réception, adresse de facturation,
- contacts (interlocuteurs : nom, fonction, téléphone, email, note),
- historique d'appels CRM (`AppelLog`) et rappels (`Rappel`),
- éventuel mirror `SapBusinessPartner` (email/phone) si présent en cache.

L'export **ne touche pas SAP live** : il ne renvoie que des données locales.
Pour une demande couvrant la source ERP, traiter en parallèle côté SAP B1.

### 6.2 Droit de rectification (art. 16)
Déjà couvert par les écrans existants (édition fiche client, contacts, compta)
qui propagent l'email vers SAP. Procédure : corriger via l'UI ; l'admin peut le
faire pour le compte d'une personne sur demande tracée.

### 6.3 Droit d'opposition (art. 21)
Marquer l'interlocuteur comme « ne plus contacter » et cesser la prospection.
**⚠️ À CONFIRMER / TODO** : il n'existe pas aujourd'hui de drapeau
« opt‑out / ne pas démarcher » au niveau `Contact`. À ajouter (champ booléen +
filtrage des files d'appel) — hors périmètre de cet audit, à planifier.

### 6.4 Droit à l'effacement (art. 17) — **anonymisation, TODO**
> **⚠️ NE PAS implémenter d'endpoint destructeur dans le cadre de cet audit.**

Recommandation : privilégier l'**anonymisation** plutôt que la suppression dure,
pour préserver la cohérence comptable/analytique (factures, historiques agrégés)
tout en supprimant l'identification de la personne. Pistes à concevoir/valider :
- Anonymiser `Contact` (name → « Contact supprimé », phone/email → `NULL`, note → `NULL`).
- Vider les coordonnées personnelles de `Client` (`tel1/2/3`, `email`,
  `emailCompta`, `emailReception`) tout en gardant `code`/`nom` société si requis
  pour la facturation.
- **Ne pas** casser les liens comptables SAP (la facturation a sa propre
  obligation de conservation, cf. §3).
- Toute opération d'effacement doit être **tracée** (qui, quand, quel client) et
  **validée** (double contrôle / admin).
- **⚠️ Coordination SAP indispensable** : effacer côté TeleVent sans toucher SAP
  laisse la donnée dans l'ERP. Définir le processus conjoint.

**TODO** : spécifier puis implémenter ultérieurement un endpoint d'anonymisation
admin (PATCH, non destructif des écritures comptables), avec journalisation.

### 6.5 Traçabilité des accès (art. 5.2 accountability)
État actuel : pas de journal d'audit dédié des **accès en lecture** aux données
personnelles. Le `SyncLog` trace les synchros SAP, pas les consultations.
**⚠️ TODO** : prévoir une journalisation des exports RGPD (qui a exporté quel
client, quand) — a minima un `console.info` côté `app/api/rgpd/export`, idéalement
une table d'audit dédiée. À cadrer hors de cet audit (implique une migration DB).

---

## 7. Synthèse des points à valider par le métier

1. **Supabase** : région d'hébergement = UE ? (impératif) + DPA signé.
2. **SAP** : localisation de l'instance, qui porte le registre parent (art. 30).
3. **Microsoft** : région du tenant M365, scopes Graph minimaux.
4. **Hébergement de l'app Next.js** : où est‑elle déployée (UE ?).
5. **Durées de rétention** (§3) : valider chaque valeur, en particulier compta
   (obligation fiscale) et logs d'appels (24‑36 mois).
6. **Opt‑out / opposition** : ajouter un drapeau « ne pas démarcher » (§6.3).
7. **Effacement / anonymisation** (§6.4) : spécifier le processus conjoint
   TeleVent ↔ SAP avant toute implémentation.
8. **Journal d'audit** des accès/exports (§6.5).
9. Mention d'information des personnes (interlocuteurs) sur le traitement de leurs
   données — **⚠️ vérifier** qu'une mention B2B est fournie (CGV, premier contact).
