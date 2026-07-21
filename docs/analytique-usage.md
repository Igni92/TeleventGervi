# Analytique d'usage (audit interne)

Objectif : mesurer **le temps passé et le nombre de clics sur chaque écran**,
avec le contexte (appareil, réseau, défilement) et surtout **les problèmes**
(erreurs JS, rage-clicks, clics morts, interactions lentes) — pour auditer
l'application et voir « ce qui ne va pas et ce qui est bien ».

## Comment ça marche

```
components/UsageTracker.tsx   ──(navigator.sendBeacon, par lots)──►  POST /api/usage
        (client, instrumente chaque écran)                          lib/usage.ts (ingestion best-effort)
                                                                        │  écrit en raw SQL
                                                                        ▼
                                              UsageScreenView (1 ligne / visite d'écran)
                                              UsageEvent      (1 ligne / événement de diagnostic)
```

- Le tracker est monté une seule fois dans `app/providers.tsx` (sous
  `SessionProvider`) → il couvre **tous** les écrans, y compris le cockpit
  `/dashboard` (plein écran) et la connexion.
- Il est **totalement non-bloquant** : toute exception est avalée, côté client
  comme côté serveur. Le tracking ne doit jamais gêner l'utilisateur.
- L'identité (email/nom) n'est PAS envoyée par le client : la route la résout
  depuis le cookie de session (rattachement fiable, même au déchargement).
- Envoi par lots : au changement d'écran, à la mise en arrière-plan, au
  déchargement, plus un flush périodique des événements (20 s).

## Ce qui est mesuré

### `UsageScreenView` — une ligne par visite d'écran (le « fichier » central)

| Colonne | Sens |
|---|---|
| `sessionId` | regroupe une visite (onglet navigateur) |
| `userEmail` / `userName` / `userId` | auteur (NULL si non connecté) |
| `path` / `screen` / `prevPath` | route, libellé humain, écran précédent (flux) |
| `deviceType` / `os` / `browser` / `browserVersion` | **PC vs mobile**, système, navigateur |
| `viewportW/H` / `screenW/H` / `dpr` | tailles d'écran, densité (zoom/rétina) |
| `connection` / `lang` / `referrer` | réseau (`4g`…), langue, référent externe |
| `enteredAt` / `leftAt` / `durationMs` | **temps passé** sur l'écran |
| `activeMs` | temps réellement **au 1er plan** (onglet visible) |
| `clicks` / `deadClicks` / `rageClicks` | **clics**, dont clics « morts » et de frustration |
| `keypresses` | frappes clavier |
| `maxScrollPct` / `scrollableHeight` | **profondeur de défilement** (0–100 %) |
| `jsErrors` / `slowInteractions` / `maxInteractionMs` | **problèmes** : erreurs, lenteurs (INP-like) |
| `loadMs` | temps jusqu'à l'app prête (1re vue) |

### `UsageEvent` — flux fin de diagnostic

`type` ∈ `click · rage_click · dead_click · error · unhandled_rejection ·
resource_error · slow_interaction · scroll_depth · nav · perf`, avec `target`
(élément visé), `value` (latence, %…), `message` (erreur) et `meta` (JSON libre).

## Installation en base

Additif et idempotent (RLS deny-all, comme toutes les autres tables) :

```bash
# via psql
psql "$DATABASE_URL" -f prisma/migrations/manual/20260721_usage_analytics.sql
# ou via le script DDL
node scripts/ddl-usage-analytics.mjs
# ou via Supabase MCP (apply_migration)
```

## Auditer

Rapport prêt à l'emploi (temps par écran, PC/mobile, problèmes, top erreurs) :

```bash
node scripts/audit-usage.mjs          # 30 derniers jours
node scripts/audit-usage.mjs 7        # 7 derniers jours
```

### Quelques requêtes SQL utiles

Temps et clics par écran (30 j) :

```sql
SELECT COALESCE(screen, path) AS ecran,
       COUNT(*)                    AS visites,
       ROUND(SUM("durationMs")/60000.0) AS minutes,
       ROUND(AVG("durationMs")/1000.0)  AS moy_sec,
       SUM(clicks)                 AS clics,
       ROUND(AVG("maxScrollPct"))  AS scroll_moyen
FROM "UsageScreenView"
WHERE "enteredAt" >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY minutes DESC;
```

Écrans les plus problématiques :

```sql
SELECT COALESCE(screen, path) AS ecran,
       SUM("jsErrors")         AS erreurs,
       SUM("rageClicks")       AS rage_clicks,
       SUM("deadClicks")       AS clics_morts,
       SUM("slowInteractions") AS lenteurs,
       MAX("maxInteractionMs") AS pire_inp_ms
FROM "UsageScreenView"
WHERE "enteredAt" >= NOW() - INTERVAL '30 days'
GROUP BY 1
HAVING SUM("jsErrors") + SUM("rageClicks") + SUM("deadClicks") + SUM("slowInteractions") > 0
ORDER BY erreurs DESC, rage_clicks DESC;
```

Répartition PC / mobile :

```sql
SELECT "deviceType", COUNT(*) AS visites,
       ROUND(SUM("durationMs")/60000.0) AS minutes
FROM "UsageScreenView"
WHERE "enteredAt" >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY visites DESC;
```

Messages d'erreur récents :

```sql
SELECT "createdAt", COALESCE(screen, path) AS ecran, type, message
FROM "UsageEvent"
WHERE type IN ('error','unhandled_rejection','resource_error')
ORDER BY "createdAt" DESC LIMIT 50;
```

## RGPD / rétention

Outil **interne** (poste de travail salarié, domaine restreint, appli
`noindex`). Finalité : audit et amélioration de l'outil de travail — pas de
profilage publicitaire. Données minimisées (pas de contenu saisi, pas de PII
client ; seul l'email professionnel de l'opérateur rattache l'usage). Pour
purger l'historique au-delà d'une durée de conservation choisie :

```sql
DELETE FROM "UsageScreenView" WHERE "enteredAt" < NOW() - INTERVAL '180 days';
DELETE FROM "UsageEvent"      WHERE "createdAt" < NOW() - INTERVAL '180 days';
```

Cf. `docs/rgpd-conformite.md` pour la posture générale.
