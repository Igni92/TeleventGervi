-- Promotions : ciblage par TYPE DE MAGASIN + tarif unitaire imposé.
--
-- `storeType` (nullable) restreint la promo aux magasins d'un type donné
-- (Client.type = EXPORT | GMS | CHR). NULL = tous les magasins.
--
-- Le tarif imposé (kind='PRICE') NE nécessite PAS de nouvelle colonne : il
-- réutilise `value` (qui porte alors le PRIX UNITAIRE fixe au lieu du % de
-- remise). C'est `kind` qui distingue PERCENT (value=%) de PRICE (value=€).
--
-- Additif, non destructif, idempotent. Miroir de scripts/ddl-promos-store-type.mjs.

ALTER TABLE "Promo"
  ADD COLUMN IF NOT EXISTS "storeType" TEXT;

CREATE INDEX IF NOT EXISTS "Promo_storeType_idx" ON "Promo" ("storeType");
