CREATE TABLE planner_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'drafting', 'approved', 'published', 'archived')),
  scheduled_for TEXT,
  related_strategy_id INTEGER REFERENCES trading_strategies(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL DEFAULT 'assistant',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_planner_items_status ON planner_items(status);
CREATE INDEX idx_planner_items_scheduled_for ON planner_items(scheduled_for);

CREATE TABLE trading_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER REFERENCES trading_strategies(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'analysis' CHECK (note_type IN ('analysis', 'idea', 'review', 'risk')),
  created_by TEXT NOT NULL DEFAULT 'assistant',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_trading_notes_strategy_id ON trading_notes(strategy_id);
CREATE INDEX idx_trading_notes_created_at ON trading_notes(created_at);
