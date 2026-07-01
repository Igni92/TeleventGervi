# Audit — Algorithme de la Console de télévente

> Périmètre : file d'appel, rappels, et **heure d'appel optimisée** (« analyse
> comportementale »). Objectif : identifier pourquoi la précision est faible,
> pourquoi il n'y a pas de notifications, et comment obtenir une **gestion fine
> des heures auxquelles les clients décrochent**.
>
> Sévérité : 🔴 Critique · 🟠 Majeur · 🟡 Mineur · ℹ️ Info — Effort : ⚡ quick win · 🛠️ chantier.
>
> Fichiers clés : `lib/insights.ts`, `app/api/console/route.ts`,
> `components/console/CallConsole.tsx`, `app/api/appels/route.ts`,
> `app/api/reminders/route.ts`, `lib/paris-time.ts`, `prisma/schema.prisma`.

---

## 1. Ce que fait l'algorithme aujourd'hui

**Heure / jour optimal (`lib/insights.ts › computeInsights`)**
- Prend les `AppelLog` du client sur 180 j (fournis par `/api/console`), **ne
  garde que `type === "COMMANDE"**`.
- `bestHour` = heure (0–23) la plus fréquente parmi les commandes des **90
  derniers jours** (mode). `hourWindow` = `[bestHour, bestHour+1]`.
- `medianHour` = médiane des heures de commande → sert à **trier la file**
  (tri « Heure optimale », tri par défaut de la console).
- `bestDayOfWeek` = jour de semaine le plus fréquent (mode).
- `medianIntervalDays` = médiane des écarts entre commandes.
- `confidence` : `low` (<4 cdes), `medium` (4–9), `high` (≥10).

**File d'appel (`/api/console`)**
- Un client entre dans la file si `joursAppel` (CSV de jours saisi à la main)
  contient le jour courant, qu'il n'a **aucun appel loggé aujourd'hui**, ni
  rappel futur, ni pré-commande future.
- Toute action (Commande, À demain, ou un motif NRP/Refus/…) le bascule en
  « Fait » et le retire de la file du jour.

**Rappels (`/api/reminders`)**
- Créent une ligne `Rappel` + un **événement calendrier Microsoft** (Graph).
- Un rappel futur *masque* le client de la file (`futureSnooze`).

---

## 2. Précision de l'heure d'appel — les vraies causes

### 🔴 2.1 On mesure l'heure du COMMERCIAL, pas celle du CLIENT
`app/api/appels/route.ts:62` — chaque log est horodaté `heureAppel: new Date()`
**au moment du clic**. `computeInsights` en déduit la « meilleure heure ».

Conséquence : si un agent passe ses appels en batch le matin, **toutes** les
commandes tombent le matin → l'algo « découvre » que le client commande le
matin… parce que personne ne l'appelle l'après‑midi. C'est un **biais de
confirmation auto-réalisateur** : le système ne peut structurellement jamais
apprendre qu'un client décrocherait mieux à 16 h. La « meilleure heure »
reflète l'agenda de l'agent, pas la joignabilité du client.

### 🔴 2.2 Le signal « décroché / pas de réponse » est jeté
Le champ `AppelLog.outcome` (`NRP`, `REPONDEUR`, `REFUS`, `RAPPELE`, `LITIGE`)
existe (`prisma/schema.prisma:565`), est écrit par la console
(`CallConsole.tsx` → `onOutcome`) et l'API (`app/api/appels/route.ts:59`)…
mais **n'est jamais relu** :
- `computeInsights` ne regarde que `type === "COMMANDE"`.
- Le `select` de `/api/console` (`route.ts:116-120`) **ne remonte même pas
  `outcome`**. La donnée est morte (pas exportée RGPD non plus).

C'est exactement la donnée demandée : « à quelle heure le client **décroche** ».
On a de quoi calculer un **taux de décroché par créneau** =
`(décrochés) / (tentatives)` par tranche horaire — mais rien ne l'exploite.

### 🔴 2.3 Le calcul d'heure tourne en UTC (décalage 1–2 h)
`computeInsights` est exécuté **côté serveur** (`/api/console`, seule
utilisation — vérifié). Le serveur tourne en **UTC** (aucun `TZ=Europe/Paris`
défini : ni `.env.example`, ni `vercel.json`, ni `next.config.mjs` ; c'est
précisément pourquoi `lib/paris-time.ts` existe).

Or `insights.ts` utilise `d.getHours()` / `d.getDay()` **bruts** (lignes 69, 91,
98) au lieu des helpers Paris. Résultat : une commande prise à **10 h 30 Paris en
été** est rangée dans le bucket **08 h**. `bestHour`, `hourWindow`, `medianHour`
et `bestDayOfWeek` sont tous **décalés de 1 h (hiver) à 2 h (été)** — et comme
`medianHour` **trie la file**, l'ordre « Heure optimale » lui‑même est faussé
(et peut changer au passage à l'heure d'été). C'est un bug franc, incohérent
avec le reste de l'app qui a été soigneusement « parisianisé » (cf. Lot 6 de
`TODO-AUDIT.md`).

### 🟠 2.4 Échantillons trop petits, aucune robustesse
- Recommandation dès **3 commandes** ; `high` à 10. Sur 3–5 points, le *mode*
  d'heure est très bruité : une seule commande à une heure atypique fait
  basculer la reco.
- Fenêtre « optimale » naïve : `[h, h+1]` fixe, elle ne s'élargit pas au vrai
  cluster (ex. un client régulier 9 h–11 h est réduit à « 9 h–10 h »).
- Aucun **lissage** ni repli **cold-start** : un client neuf ou peu actif
  renvoie `medianHour = null` → placé en **fin** de file (`?? 99`,
  `CallConsole.tsx:204`). Les clients à prospecter/réactiver — ceux qu'on veut
  le plus travailler — sont donc **déprioritisés** par le tri par défaut.
- Pas d'agrégation par **type / secteur / jour** pour donner une heure de repli
  quand l'historique individuel est mince.

### 🟡 2.5 `bestDayOfWeek` redondant et non réconcilié
Même biais COMMANDE-only + UTC, et il **double** `joursAppel` (saisi main) sans
jamais le confronter (« tu appelles le lundi mais il commande le jeudi »).

---

## 3. File & cadence — l'intelligence calculée n'est pas utilisée

### 🟠 3.1 La cadence idéale est calculée puis ignorée
`medianIntervalDays` (fréquence de commande) est affichée mais **ne pilote pas**
la file. Celle-ci dépend uniquement de `joursAppel` statique. Un client qui
commande tous les ~21 j mais dont `joursAppel = Lun,Mer,Ven` est proposé 3×/sem
quand même. L'algo « sait » quand rappeler, mais ne le fait pas.

### 🟠 3.2 « Pas de réponse » sort le client pour toute la journée
`/api/console:196` : **tout** log du jour (y compris `NRP`) bascule le client en
« Fait ». Donc un « Pas de réponse » à 9 h le fait **disparaître jusqu'à son
prochain jour d'appel**. Pour de la télévente c'est contre-productif : un NRP
devrait déclencher une **nouvelle tentative le jour même**, idéalement sur un
créneau différent (cf. §2.2). Aujourd'hui rien ne le fait remonter.

---

## 4. Notifications — quasi inexistantes

### 🔴 4.1 Aucun déclencheur de rappel
La seule « notif » est l'événement **calendrier Outlook** créé à la création du
rappel. Il n'existe **pas** :
- de **cron / fonction planifiée** qui lit les `Rappel` dus (aucun cron ;
  `vercel.json` ne déclare aucun `crons`) ;
- de **notification in-app** (toast/bandeau) quand un rappel arrive à échéance ;
- de **web-push / service worker / PWA** (aucune dépendance `web-push`, pas de
  `manifest.json`, pas de `sw.js`) ;
- de résurgence dans la console : un rappel ne fait que **masquer** le client
  (`futureSnooze`) — il ne le fait **jamais réapparaître** « à rappeler
  maintenant » à l'heure dite.

Conséquence : un rappel programmé à 14 h repose à 100 % sur l'agent qui surveille
Outlook. S'il ne regarde pas, le rappel est **silencieusement manqué**. La
console ne dit jamais « 3 rappels dus maintenant ».

### 🟠 4.2 Rien pour « heure optimale atteinte »
Même si l'heure optimale était fiable, rien ne prévient l'agent « c'est le bon
créneau pour appeler X ». L'info est passive (tri + badge), jamais poussée.

---

## 5. Modèle de données — ce qui bloque la précision

### 🟠 5.1 Pas de modèle « tentative » vs « décroché »
Pour savoir « à quelle heure le client décroche », il faut logger **chaque
tentative** avec son issue **et** son horodatage, puis calculer un taux de
décroché par créneau. Aujourd'hui : un seul log au clic final, `outcome` non
exploité, pas de distinction sonnerie/répondeur/décroché-sans-commande.
L'enum `outcome` est la bonne fondation — il faut le **persister-pour-analyse**
et le brancher aux insights.

### 🟡 5.2 Joignabilité au niveau client, pas contact
Le modèle `Contact` existe (plusieurs interlocuteurs), mais l'heure de décroché
est calculée par **client** — or deux interlocuteurs peuvent avoir des
disponibilités très différentes.

---

## 6. Feuille de route recommandée (priorisée)

### Lot A — Corriger la mesure (fondations, avant tout le reste)
1. 🔴⚡ **Parisianiser `computeInsights`** : bucketer les heures/jours en
   Europe/Paris (helper dérivé de `lib/paris-time.ts`), pas en UTC. Corrige
   immédiatement le tri « Heure optimale » et la « meilleure heure ».
2. 🔴🛠️ **Exploiter `outcome`** : le remonter dans le `select` de
   `/api/console`, et calculer un **taux de décroché par créneau** (décroché =
   `COMMANDE|REFUS|RAPPELE|LITIGE` ; non-décroché = `NRP|REPONDEUR`). La
   « meilleure heure » devient *« heure où il décroche le plus »*, pas *« heure
   où l'agent a saisi »*.
3. 🟠🛠️ **Logger chaque tentative** (déjà le cas via les motifs) et, à terme,
   séparer *tentative* / *connexion* pour un vrai taux de réponse horaire.

### Lot B — Rendre l'heure fiable & robuste
4. 🟠🛠️ **Lissage + fenêtre réelle** : agréger en créneaux de 30 min avec
   lissage (moyenne glissante), fenêtre = vrai cluster (pas `+1 h` fixe).
5. 🟠🛠️ **Cold-start** : repli sur une heure moyenne par **type/secteur** quand
   l'historique individuel < seuil ; ne plus envoyer ces clients en fin de file.
6. 🟡⚡ **Seuils de confiance** relevés et affichage « n tentatives / m
   décrochés » pour la transparence.

### Lot C — Cadence pilotée par la donnée
7. 🟠🛠️ **Proposer la prochaine date d'appel** à partir de `medianIntervalDays`
   (avec garde-fous), au lieu du seul `joursAppel` manuel — ou au minimum
   **signaler** les incohérences jours d'appel vs jours de commande.
8. 🟠⚡ **Retry NRP le jour même** : un `NRP`/`REPONDEUR` ne retire plus le
   client de la file — il le repropose plus tard dans la journée, sur un autre
   créneau.

### Lot D — Notifications
9. 🔴🛠️ **Rappels dus dans la console** : bandeau + compteur « X rappels dus
   maintenant », clic → ouvre le client. Ne dépend d'aucune infra externe.
10. 🟠🛠️ **Cron de rappels** (Vercel Cron) : marque/agrège les rappels dus,
    alimente le bandeau, et — option — envoie un mail/notification.
11. 🟡🛠️ **Web-push (PWA)** pour notifier hors onglet (« il est 16 h, c'est le
    créneau de X » / « rappel dû »). Nécessite service worker + `web-push`.

---

## 7. Synthèse

La brique statistique est propre et bien intentionnée, mais **trois défauts la
rendent imprécise à la racine** : (1) elle mesure l'heure de saisie du commercial
et non le décroché du client ; (2) elle **jette le signal `outcome`** qui
contient précisément la joignabilité ; (3) elle **calcule en UTC**, ce qui
décale l'heure affichée *et* le tri de la file de 1–2 h.

Côté **notifications**, il n'existe en pratique **rien** en dehors de
l'événement Outlook créé à la main : aucun rappel n'est poussé, aucun n'est
resurfacé dans la console à l'heure due.

Le **Lot A** (parisianisation + exploitation d'`outcome`) est le préalable
indispensable : sans une mesure juste du décroché, tout raffinement en aval
optimise du bruit.

---

## 8. État d'implémentation (branche `claude/console-algorithm-audit-3ut26e`)

- ✅ **Lot A** — `computeInsights` parisianisé (`parisHourMinute`) ; `outcome`
  remonté dans `/api/console` et exploité → **taux de décroché par créneau**.
- ✅ **Lot B** — créneaux **30 min** avec repli heure pleine ; **cold-start** par
  type de client (les clients neufs ne finissent plus en fin de file).
- ✅ **Lot C** — `cadenceStatus` (en retard vs fréquence) ; **retry NRP** (un
  « pas de réponse » garde le client dans la file, badge RETENTER).
- ✅ **Lot D** — **bandeau in-app « rappels dus »** + **push PWA** (Web-Push,
  service worker, cron `/api/cron/reminders`, opt-in par appareil).

Tests : `lib/insights.test.ts` (TZ été/hiver, décroché > densité, NRP, legacy,
cadence). Suite complète **203 verts**, lint 0.

### Étapes de déploiement (à faire côté prod — non automatisables ici)

1. **Base de données** : appliquer la migration
   `prisma/migrations/manual/20260701_push_notifications.sql`
   (`psql "$DATABASE_URL" -f …` ou Supabase), puis `prisma generate` au build.
2. **Clés VAPID** : `npx web-push generate-vapid-keys` → renseigner
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (cf. `.env.example`).
   Sans elles, l'app tourne normalement, push simplement masqué.
3. **Cron** : définir `CRON_SECRET` (Vercel l'injecte en `Authorization`). Le
   cron est déclaré dans `vercel.json` (`*/5 * * * *`, nécessite un plan Vercel
   autorisant cette fréquence — sinon ajuster).
4. **Icônes PWA** : `public/icon-192.png` / `icon-512.png` sont des placeholders
   (anneau radar de marque) — à remplacer par le vrai logo si souhaité.

### Pistes suivantes (non implémentées)

- Notification push « créneau optimal atteint » pour un client (le cron est
  déjà architecturé pour l'accueillir — nécessite un état de dédup par
  client/jour pour éviter le bruit).
- Cadence pilotant réellement `joursAppel` (aujourd'hui : signal d'écart affiché,
  pas d'action automatique).
- Décroché au niveau **contact** (interlocuteur) et non seulement client.
