-- @destructive-reviewed
-- Reine Typverbreiterung: zeitbasierte Artikel-IDs aus Date.now() sind
-- groesser als INTEGER, bleiben aber sicher innerhalb von JavaScripts
-- exakt darstellbarem Zahlenbereich. Vorhandene IDs werden nicht veraendert.
ALTER TABLE products ALTER COLUMN id TYPE BIGINT;
ALTER TABLE sale_items ALTER COLUMN product_id TYPE BIGINT;
