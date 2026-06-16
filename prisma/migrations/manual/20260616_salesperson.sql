-- Audit B4 — référentiel des commerciaux SAP (SalesPersons).
-- NON APPLIQUÉ automatiquement (cf. scripts/ddl-salesperson.mjs --apply). Idempotent.

CREATE TABLE IF NOT EXISTS "SalesPerson" (
  "slpName"  TEXT PRIMARY KEY,
  "code"     INTEGER,
  "email"    TEXT,
  "active"   BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "SalesPerson_code_key" ON "SalesPerson" ("code");

-- Seed bootstrap (commerciaux commissionnés connus, cf. lib/salespeople.ts) —
-- non destructif. Le miroir SAP (lib/sapMirror.ts) complète/réactualise ensuite.
INSERT INTO "SalesPerson" ("slpName", "code", "email", "active", "syncedAt") VALUES
  ('MM',  16, 'm.mandine@gervifrais.com',  true, NOW()),
  ('JMG',  1, 'jm.gunslay@gervifrais.com', true, NOW()),
  ('AG',   7, 'm.essombe@gervifrais.com',  true, NOW())
ON CONFLICT ("slpName") DO NOTHING;
