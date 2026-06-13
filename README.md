# TeleVent — Application de gestion télévente

Application web professionnelle de listing et gestion des clients télévente, avec synchronisation du calendrier Microsoft.

## Stack technique

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS** + composants shadcn/ui
- **Prisma ORM** + PostgreSQL (Supabase)
- **NextAuth.js v5** avec Microsoft Azure AD
- **Microsoft Graph API** pour la synchronisation agenda
- **React Hook Form** + Zod pour la validation
- **TanStack Query** pour le cache client

---

## Fonctionnalités

- **Listing clients** avec recherche temps réel, filtres par type/groupe, pagination
- **CRUD clients** : création, modification avec validation complète
- **Rappels téléphoniques** : création d'un rappel = création automatique d'un événement dans Microsoft Calendar
- **Authentification Microsoft** via Azure AD (SSO entreprise)
- **Badges colorés** : bleu (EXPORT), orange (GMS), vert (CHR)
- Interface **responsive** (tablette incluse)

---

## Installation locale

### 1. Prérequis

- Node.js 18+
- npm ou pnpm
- Compte Supabase (ou autre PostgreSQL)
- Application Azure AD enregistrée

### 2. Cloner et installer

```bash
git clone <repo-url>
cd televent
npm install
```

### 3. Variables d'environnement

Copier `.env.example` vers `.env.local` et remplir :

```env
# Microsoft Azure AD
AZURE_CLIENT_ID=<votre-client-id>
AZURE_CLIENT_SECRET=<votre-client-secret>
AZURE_TENANT_ID=<votre-tenant-id>

# NextAuth (générer avec: openssl rand -base64 32)
NEXTAUTH_SECRET=<secret-aleatoire>
NEXTAUTH_URL=http://localhost:3000

# Base de données PostgreSQL (Supabase)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
```

### 4. Configuration Azure AD

Dans le portail Azure, créer une application avec :
- **Type de compte** : Comptes dans cet annuaire organisationnel uniquement
- **URI de redirection** : `http://localhost:3000/api/auth/callback/microsoft-entra-id`
- **Permissions API** : `openid`, `profile`, `email`, `offline_access`, `Calendars.ReadWrite`, `User.Read`

### 5. Base de données

```bash
# Appliquer le schéma Prisma à la base de données
npm run db:push

# Ou créer une migration nommée
npm run db:migrate
```

### 6. Lancer en développement

```bash
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000)

---

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Démarrer en production |
| `npm run lint` | Vérification ESLint |
| `npm run format` | Formatage Prettier |
| `npm run db:push` | Appliquer le schéma sans migration |
| `npm run db:migrate` | Créer et appliquer une migration |
| `npm run db:studio` | Ouvrir Prisma Studio |
| `npm run db:generate` | Regénérer le client Prisma |

---

## Déploiement Vercel

### 1. Préparer le repo

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <url-du-repo>
git push -u origin main
```

### 2. Configurer Vercel

1. Connecter le repo sur [vercel.com](https://vercel.com)
2. Framework : **Next.js** (détecté automatiquement)
3. Ajouter toutes les variables d'environnement (onglet Settings > Environment Variables) :
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`
   - `AZURE_TENANT_ID`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` → URL de production Vercel (ex: `https://televent.vercel.app`)
   - `DATABASE_URL`

4. Dans Azure AD, ajouter l'URI de redirection de production :
   ```
   https://televent.vercel.app/api/auth/callback/microsoft-entra-id
   ```

5. Déployer.

### 3. Appliquer le schéma en production

Via le terminal ou Vercel CLI :
```bash
npx prisma db push
```

---

## Structure du projet

```
/app
  /api/auth/[...nextauth]/route.ts   # NextAuth handlers
  /api/clients/route.ts              # CRUD clients (GET, POST)
  /api/clients/[id]/route.ts         # CRUD client (GET, PUT, DELETE)
  /api/reminders/route.ts            # Rappels + Graph API
  /clients/page.tsx                  # Listing clients
  /clients/[id]/page.tsx             # Édition client
  /clients/new/page.tsx              # Création client
  /login/page.tsx                    # Page de connexion
  layout.tsx                         # Root layout
  page.tsx                           # Redirection
/components
  /ui/                               # Composants shadcn/ui
  ClientForm.tsx                     # Formulaire client
  ClientTable.tsx                    # Tableau avec filtres
  Navbar.tsx                         # Barre de navigation
  ReminderModal.tsx                  # Modal rappel
/lib
  auth.ts                            # Configuration NextAuth
  graph.ts                           # Client Microsoft Graph
  prisma.ts                          # Client Prisma singleton
  utils.ts                           # Utilitaires
  validations.ts                     # Schémas Zod
/prisma
  schema.prisma                      # Modèle de données
```

---

## Modèle de données

```prisma
model Client {
  id      String   @id @default(cuid())
  code    String   @unique        # Ex: CLI001
  nom     String
  type    String   # EXPORT | GMS | CHR
  groupe  String   # A | B | C | D
  tel1    String
  tel2    String?
  tel3    String?
  notes   String?
  rappels Rappel[]
}

model Rappel {
  id         String   @id @default(cuid())
  clientId   String
  dateRappel DateTime
  note       String?
  msEventId  String?  # ID événement Microsoft Calendar
  statut     String   @default("PLANIFIE") # PLANIFIE | FAIT | ANNULE
}
```
