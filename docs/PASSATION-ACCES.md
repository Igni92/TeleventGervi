# Passation — Accès & comptes techniques

> À exécuter **avant le dernier jour**. Ce document ne remplace pas
> `DEPLOIEMENT.md` / `docs/OPS-DEPLOIEMENT.md` (qui expliquent *comment*
> déployer) : il liste *qui a les clés* et ce qu'il faut faire pour que
> personne ne se retrouve bloqué après le départ.
>
> Rempli avec ce qui est vérifiable depuis le code. Les cases `[À COMPLÉTER]`
> ne peuvent être remplies que par vous — ne partez pas sans les avoir traitées.

---

## 0. Action n°1 — le verrou admin (à faire en tout premier)

`lib/permissions.ts` code un **unique** admin « bootstrap », indélogeable et en dur :

```ts
export const ADMIN_EMAILS = ["m.mandine@gervifrais.com"] as const;
```

Tant que cette adresse est la seule à donner l'accès admin, **si ce compte
email est désactivé à votre départ, plus personne ne peut se promouvoir admin
depuis l'écran Effectifs** (il faut déjà être admin pour promouvoir quelqu'un
d'autre). C'est le risque de lock-out n°1 du projet.

Deux actions **indépendantes et complémentaires**, à faire toutes les deux :

- [ ] **Sans déploiement** : une fois que la personne qui reprend s'est
      connectée au moins une fois (son `User` existe alors en base), passer
      `isAdmin = true` sur sa ligne — via Prisma Studio (`npm run db:studio`)
      ou en SQL direct (Supabase → SQL editor) :
      ```sql
      UPDATE "User" SET "isAdmin" = true WHERE email = '<email-successeur>';
      ```
- [ ] **Avec déploiement** : ajouter une deuxième adresse dans `ADMIN_EMAILS`
      (`lib/permissions.ts`) — un email qui restera valide après votre départ
      (idéalement une adresse générique/IT, pas un compte nominatif qui peut
      lui aussi être désactivé un jour) — puis `git commit` + déployer.

Sans ça, la seule porte de secours en cas de blocage total est un accès direct
à la base Supabase (SQL) pour repasser un compte en admin à la main.

---

## 1. Inventaire des comptes / accès externes

| Service | Rôle dans l'app | Propriétaire actuel | Où sont les identifiants |
|---|---|---|---|
| **GitHub** — `igni92/televentgervi` | Code source, PR, `Actions` (cron sync) | [À COMPLÉTER] | [À COMPLÉTER] |
| **Vercel** — projet `televent-gervi` | Hébergement, build, variables d'env, domaine `televent.gervifrais.com` | [À COMPLÉTER] | [À COMPLÉTER] |
| **Supabase** — projet prod `iokraagfwrpklyhgwknv` | Base PostgreSQL de production (`DATABASE_URL`) | [À COMPLÉTER] | [À COMPLÉTER] |
| **Microsoft Entra ID (Azure AD)** — tenant `gervifrais.com` | SSO login (`AZURE_CLIENT_ID/SECRET/TENANT_ID`), Graph API (agenda rappels, envoi mail relances/congés) | [À COMPLÉTER — souvent l'IT interne ou la direction] | Portail Azure, App registration |
| **SAP Business One Service Layer** | Source de vérité métier (`SAP_B1_BASE_URL/COMPANY_DB/USERNAME/PASSWORD`) | [À COMPLÉTER — souvent l'intégrateur ERP] | [À COMPLÉTER] |
| **Domaine `gervifrais.com` / DNS** | Sert `televent.gervifrais.com` | [À COMPLÉTER] | Registrar |
| **GitHub Actions secret `CRON_SECRET`** | Autorise le workflow `sap-sync.yml` à déclencher la synchro (toutes les 30 min) | [À COMPLÉTER] | GitHub → Settings → Secrets |
| **WhatsApp Business (Meta for Developers)** | Notif congés au patron (optionnel — `WHATSAPP_ACCESS_TOKEN`) | [À COMPLÉTER] | [À COMPLÉTER] |
| **Clés VAPID** (notifications push PWA) | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — (régénérables sans casser l'appli : `npx web-push generate-vapid-keys`) | — |
| **Gestionnaire de mots de passe / coffre** où sont stockés les secrets ci-dessus | — | [À COMPLÉTER] | [À COMPLÉTER] |

---

## 2. Checklist avant le dernier jour

- [ ] Verrou admin traité (§0 — les deux actions).
- [ ] Ajouter le successeur (ou un compte IT) comme **collaborateur/admin** sur
      le repo GitHub `igni92/televentgervi`.
- [ ] Ajouter le successeur comme **membre** de l'équipe/projet **Vercel**
      `televent-gervi` (Settings → Members), ou transférer le projet.
- [ ] Ajouter le successeur comme **membre** de l'organisation **Supabase**
      hébergeant le projet `iokraagfwrpklyhgwknv`.
- [ ] Identifier et documenter **qui a les droits admin du tenant Azure AD**
      `gervifrais.com` (nécessaire pour renouveler `AZURE_CLIENT_SECRET` quand
      il expire, ou ajuster les permissions Graph `Mail.Send`/`Calendars.ReadWrite`).
- [ ] Documenter/transférer les identifiants **SAP B1** (`SAP_B1_USERNAME`/`PASSWORD`)
      et le contact côté intégrateur/éditeur SAP.
- [ ] Vérifier que **quelqu'un d'autre** connaît/possède le secret `CRON_SECRET`
      (sans lui, le workflow GitHub Actions `sap-sync.yml` cesse de synchroniser
      SAP → miroir figé, symptôme déjà vécu une fois — cf. commentaire du
      workflow — CA du jour affiché à 0).
- [ ] Transférer l'accès au **gestionnaire de mots de passe / coffre** où vous
      stockez ces secrets aujourd'hui.
- [ ] Donner au successeur le contact **IT/ERP interne à Gervi** (nom, email,
      téléphone) pour tout ce qui touche Azure AD et SAP côté entreprise.
- [ ] Vérifier qui reçoit les alertes en cas d'échec du workflow GitHub Actions
      (onglet Actions → notifications) — sinon une panne de sync passe inaperçue.

---

## 3. Ce qui casse si rien n'est fait

- **Verrou admin non traité** → si `m.mandine@gervifrais.com` est désactivé,
  plus personne ne peut promouvoir un admin depuis l'UI ; seul un accès SQL
  direct à Supabase permet de s'en sortir.
- **`CRON_SECRET` perdu / GitHub Actions désactivé sans repli** → le miroir SAP
  (factures, marges, KPI pilotage) s'arrête d'évoluer silencieusement ; rien ne
  plante, les écrans continuent d'afficher les dernières données synchronisées
  (potentiellement obsolètes de plusieurs jours). Un admin peut toujours
  relancer une synchro manuelle depuis *Paramètres → Données · SAP*.
- **`AZURE_CLIENT_SECRET` expiré et personne pour le renouveler** → plus aucune
  connexion possible à l'application (SSO Microsoft en panne totale).
- **Webhook GitHub → Vercel désynchronisé** → les push sur `main` ne déclenchent
  plus de déploiement (correctif connu : Vercel → Settings → Git →
  Disconnect/Reconnect, cf. `docs/OPS-DEPLOIEMENT.md`).

---

## 4. Contact de continuité

- Successeur / repreneur technique : [À COMPLÉTER]
- Contact métier (qui utilisait le compte admin au quotidien) : [À COMPLÉTER]
- Contact IT/ERP Gervi (Azure AD, SAP) : [À COMPLÉTER]
- Date de fin d'accès prévue à vos comptes personnels (email, GitHub perso, etc.) : [À COMPLÉTER]
