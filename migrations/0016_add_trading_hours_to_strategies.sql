-- No-op migration.
-- The live database already has trading_hours, but this migration slot is kept
-- so future environments can mark the schema as caught up without failing.
SELECT 1;
