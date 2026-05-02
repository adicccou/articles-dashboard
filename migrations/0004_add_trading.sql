-- Trading Strategies
CREATE TABLE trading_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  knowledge_base_id INTEGER REFERENCES knowledge_bases(id) ON DELETE SET NULL,

  -- cTrader API Configuration
  ctrader_login TEXT NOT NULL,
  ctrader_password TEXT NOT NULL,
  ctrader_account_id TEXT NOT NULL UNIQUE,
  ctrader_server TEXT,

  -- Strategy Configuration
  symbol TEXT NOT NULL,
  strategy_type TEXT NOT NULL CHECK (strategy_type IN ('scalping', 'daytrading', 'swing', 'position')),
  lot_size REAL DEFAULT 0.1,
  stop_loss_pips INTEGER,
  take_profit_pips INTEGER,
  max_open_positions INTEGER DEFAULT 1,

  -- AI Configuration
  claude_instructions TEXT,

  -- Notification
  telegram_chat_id TEXT,

  -- Status
  status TEXT DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'paused', 'testing')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_trading_strategies_status ON trading_strategies(status);
CREATE INDEX idx_trading_strategies_ctrader_account ON trading_strategies(ctrader_account_id);

-- Trading Executions (Log of trades executed)
CREATE TABLE trading_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL REFERENCES trading_strategies(id) ON DELETE CASCADE,

  ticket_id TEXT UNIQUE,
  symbol TEXT NOT NULL,
  volume REAL NOT NULL,
  entry_price REAL NOT NULL,
  entry_time TEXT NOT NULL,

  exit_price REAL,
  exit_time TEXT,
  pips_profit_loss REAL,
  status TEXT CHECK (status IN ('open', 'closed', 'cancelled')),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_trading_executions_strategy_id ON trading_executions(strategy_id);
CREATE INDEX idx_trading_executions_status ON trading_executions(status);

-- Trading Stats (Aggregated performance metrics)
CREATE TABLE trading_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL UNIQUE REFERENCES trading_strategies(id) ON DELETE CASCADE,

  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,

  total_pips REAL DEFAULT 0,
  avg_pips_per_trade REAL DEFAULT 0,
  max_consecutive_wins INTEGER DEFAULT 0,
  max_consecutive_losses INTEGER DEFAULT 0,

  largest_win_pips REAL DEFAULT 0,
  largest_loss_pips REAL DEFAULT 0,

  updated_at TEXT NOT NULL
);
