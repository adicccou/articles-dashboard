ALTER TABLE trading_strategies DROP COLUMN risk_per_trade_usd;
ALTER TABLE trading_strategies ADD COLUMN risk_usd_min REAL NOT NULL DEFAULT 50;
ALTER TABLE trading_strategies ADD COLUMN risk_usd_max REAL NOT NULL DEFAULT 50;
