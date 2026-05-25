CREATE TABLE IF NOT EXISTS ml_learning_experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_key TEXT NOT NULL UNIQUE,
  factor TEXT NOT NULL,
  current_value TEXT NOT NULL,
  recommended_value TEXT NOT NULL,
  impact TEXT NOT NULL DEFAULT 'LOW',
  evidence TEXT NOT NULL DEFAULT '',
  expected_winrate TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'observing' CHECK(status IN ('observing', 'applied', 'rejected', 'expired')),
  baseline_win_rate REAL,
  candidate_win_rate REAL,
  baseline_profit_factor REAL,
  candidate_profit_factor REAL,
  baseline_trades INTEGER DEFAULT 0,
  candidate_trades INTEGER DEFAULT 0,
  avoided_losers INTEGER DEFAULT 0,
  skipped_winners INTEGER DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ml_learning_experiments_status
  ON ml_learning_experiments(status, updated_at);
