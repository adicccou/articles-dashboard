PRAGMA foreign_keys=off;

CREATE TABLE trading_strategies_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  knowledge_base_id INTEGER REFERENCES knowledge_bases(id) ON DELETE SET NULL,
  assets TEXT NOT NULL DEFAULT '[]',
  strategy_type TEXT NOT NULL CHECK (strategy_type IN ('scalping', 'daytrading', 'swing', 'position')),
  risk_per_trade_usd REAL NOT NULL DEFAULT 50,
  rr_min REAL NOT NULL DEFAULT 1.5,
  rr_max REAL NOT NULL DEFAULT 2.5,
  breakeven_rr REAL NOT NULL DEFAULT 1.5,
  max_open_positions INTEGER NOT NULL DEFAULT 1,
  execution_mode TEXT NOT NULL DEFAULT 'demo' CHECK (execution_mode IN ('demo', 'live')),
  telegram_bot_token TEXT NOT NULL DEFAULT '',
  telegram_chat_id TEXT,
  status TEXT DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'paused', 'testing')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO trading_strategies_v2 (
  id,
  name,
  knowledge_base_id,
  assets,
  strategy_type,
  risk_per_trade_usd,
  rr_min,
  rr_max,
  breakeven_rr,
  max_open_positions,
  execution_mode,
  telegram_bot_token,
  telegram_chat_id,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  name,
  knowledge_base_id,
  CASE
    WHEN TRIM(COALESCE(symbol, '')) = '' THEN '[]'
    ELSE json_array(symbol)
  END,
  strategy_type,
  COALESCE(lot_size, 50),
  CASE
    WHEN stop_loss_pips IS NULL OR stop_loss_pips < 1.5 THEN 1.5
    ELSE stop_loss_pips
  END,
  CASE
    WHEN take_profit_pips IS NULL OR take_profit_pips > 2.5 THEN 2.5
    WHEN take_profit_pips < 1.5 THEN 1.5
    ELSE take_profit_pips
  END,
  1.5,
  COALESCE(max_open_positions, 1),
  CASE
    WHEN LOWER(COALESCE(ctrader_server, '')) = 'live' THEN 'live'
    ELSE 'demo'
  END,
  COALESCE(telegram_bot_token, ''),
  telegram_chat_id,
  status,
  created_at,
  updated_at
FROM trading_strategies;

DROP TABLE trading_strategies;
ALTER TABLE trading_strategies_v2 RENAME TO trading_strategies;

CREATE INDEX idx_trading_strategies_status ON trading_strategies(status);

PRAGMA foreign_keys=on;
