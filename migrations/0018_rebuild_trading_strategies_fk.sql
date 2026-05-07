PRAGMA foreign_keys=off;

CREATE TABLE trading_strategies_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  knowledge_base_id INTEGER REFERENCES knowledge_bases(id) ON DELETE SET NULL,
  strategy_text TEXT NOT NULL DEFAULT '',
  assets TEXT NOT NULL DEFAULT '[]',
  strategy_type TEXT NOT NULL CHECK (strategy_type IN ('scalping', 'daytrading', 'swing', 'position')),
  rr_min REAL NOT NULL DEFAULT 1.5,
  rr_max REAL NOT NULL DEFAULT 2.5,
  breakeven_rr REAL NOT NULL DEFAULT 1.5,
  max_open_positions INTEGER NOT NULL DEFAULT 1,
  execution_mode TEXT NOT NULL DEFAULT 'demo' CHECK (execution_mode IN ('demo', 'live')),
  telegram_bot_token TEXT NOT NULL DEFAULT '',
  telegram_chat_id TEXT,
  status TEXT DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'paused', 'testing')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  risk_usd_min REAL NOT NULL DEFAULT 50,
  risk_usd_max REAL NOT NULL DEFAULT 50,
  trading_hours TEXT NOT NULL DEFAULT '[]'
);

INSERT INTO trading_strategies_v3 (
  id,
  name,
  knowledge_base_id,
  strategy_text,
  assets,
  strategy_type,
  rr_min,
  rr_max,
  breakeven_rr,
  max_open_positions,
  execution_mode,
  telegram_bot_token,
  telegram_chat_id,
  status,
  created_at,
  updated_at,
  risk_usd_min,
  risk_usd_max,
  trading_hours
)
SELECT
  id,
  name,
  knowledge_base_id,
  COALESCE(strategy_text, ''),
  assets,
  strategy_type,
  rr_min,
  rr_max,
  breakeven_rr,
  max_open_positions,
  execution_mode,
  COALESCE(telegram_bot_token, ''),
  telegram_chat_id,
  status,
  created_at,
  updated_at,
  COALESCE(risk_usd_min, 50),
  COALESCE(risk_usd_max, 50),
  COALESCE(trading_hours, '[]')
FROM trading_strategies;

DROP TABLE trading_strategies;
ALTER TABLE trading_strategies_v3 RENAME TO trading_strategies;

CREATE INDEX idx_trading_strategies_status ON trading_strategies(status);

PRAGMA foreign_keys=on;
