-- Perf : index manquants sur les tables applicatives (Client / CRM).
-- Le miroir Sap* est déjà indexé (docDate/cardCode/slpName/updateDate) ; ces
-- tables n'avaient que leur clé primaire (+ Client.code unique), d'où des
-- seq-scans sur le scope commercial et les jointures CRM.
-- Additif, non destructif, idempotent. Appliqué via le MCP Supabase le 2026-06-20.

-- Client : scope commercial/vendeur + filtres fréquents (type, groupe SAP)
CREATE INDEX IF NOT EXISTS "Client_commercial_idx"   ON "Client" ("commercial");
CREATE INDEX IF NOT EXISTS "Client_vendeur_idx"      ON "Client" ("vendeur");
CREATE INDEX IF NOT EXISTS "Client_type_idx"         ON "Client" ("type");
CREATE INDEX IF NOT EXISTS "Client_sapGroupCode_idx" ON "Client" ("sapGroupCode");

-- AppelLog : jointure clientId + bornes temporelles + type (aucun index avant)
CREATE INDEX IF NOT EXISTS "AppelLog_clientId_heureAppel_idx" ON "AppelLog" ("clientId", "heureAppel" DESC);
CREATE INDEX IF NOT EXISTS "AppelLog_clientId_type_idx"       ON "AppelLog" ("clientId", "type");

-- Rappel : jointure clientId + statut/échéance (aucun index avant)
CREATE INDEX IF NOT EXISTS "Rappel_clientId_idx"          ON "Rappel" ("clientId");
CREATE INDEX IF NOT EXISTS "Rappel_statut_dateRappel_idx" ON "Rappel" ("statut", "dateRappel");
