# Service d'export PDF des factures (Crystal → PDF) — pour SAP B1 10.0 HANA

TeleVent attache le **PDF Crystal** d'une facture à ses relances. Or le **Service
Layer SAP ne rend pas les layouts Crystal** : il faut un petit service externe qui
charge le `.rpt` de la facture et l'exporte en PDF par `DocEntry`. TeleVent
l'appelle ensuite par HTTP (variable `RELANCE_INVOICE_PDF_URL`).

> Contexte Gervifrais : SAP Business One **10.0 FP 2302**, **version SAP HANA**.
> Partenaire : **EDOS**. Ce document est destiné à être réalisé/déployé par
> l'équipe infra/SAP (EDOS).

## Contrat d'API attendu par TeleVent

```
GET {RELANCE_INVOICE_PDF_URL}?docEntry=<DocEntry de la facture>
Authorization: Bearer <RELANCE_INVOICE_PDF_KEY>   (optionnel)

→ 200, Content-Type: application/pdf, corps = octets du PDF
→ 4xx/5xx si la facture est introuvable / erreur de rendu
```

C'est tout. Aucune autre contrainte côté TeleVent (le nom du fichier est géré chez nous).

## Ce qu'il faut réunir (côté SAP / EDOS)
1. **Le layout `.rpt`** de la facture client (Sales A/R Invoice) : dans SAP,
   *Outils → Gestionnaire d'états et de modèles* → sélectionner la mise en page
   facture → **Exporter** le `.rpt`.
2. Le **nom du paramètre de sélection** du document dans ce `.rpt` — en standard
   SAP B1 c'est `DocKey@` (parfois un paramètre `DocEntry`/`ObjectId`).
3. Un accès **lecture** à la base société **HANA** (utilisateur dédié) + le **driver
   HANA ODBC (HDBODBC)** installé sur l'hôte du service.
4. Le **runtime SAP Crystal Reports** (gratuit : « SAP Crystal Reports runtime
   engine for .NET Framework / .NET »).
5. Un **hôte Windows** qui voit la base HANA (typiquement un serveur Windows du
   parc, le même réseau que SAP).

## Squelette de service (ASP.NET, C#)

`Program.cs` (ci-joint) — minimal API qui :
- reçoit `docEntry`,
- charge le `.rpt`,
- ouvre la connexion HANA (ODBC) pour la source de données du rapport,
- positionne le paramètre `DocKey@`,
- exporte en PDF et renvoie les octets.

À compléter : chemin du `.rpt`, DSN/identifiants HANA, nom exact du paramètre,
et idéalement un contrôle du jeton `RELANCE_INVOICE_PDF_KEY`.

## Côté TeleVent (déjà prêt)
- `lib/relance/invoicePdf.ts` : appelle ce service (inerte tant que l'URL est vide).
- `lib/graph.ts` (`sendMailAsShared`) : sait joindre des PDF (base64).
- `app/api/relance/send` : récupère les PDF des factures de la relance et les
  joint ; si le service est configuré mais échoue, l'envoi est **bloqué** (on ne
  prétend pas « facture jointe » sans la pièce).

Une fois le service en ligne, il suffit de poser `RELANCE_INVOICE_PDF_URL`
(et `RELANCE_INVOICE_PDF_KEY`) dans l'environnement de l'app.
