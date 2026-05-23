CREATE TABLE IF NOT EXISTS studio_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawler_run_id INTEGER NOT NULL REFERENCES studio_crawler_runs(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES studio_campaigns(id) ON DELETE SET NULL,
  app_id INTEGER NOT NULL REFERENCES studio_apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  author TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  pain_point TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  opportunity_score INTEGER NOT NULL DEFAULT 0,
  noise_reason TEXT,
  status TEXT NOT NULL DEFAULT 'signal' CHECK(status IN ('candidate', 'filtered', 'signal', 'rejected')),
  raw_data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_signals_run_id
  ON studio_signals(crawler_run_id, opportunity_score DESC);

CREATE INDEX IF NOT EXISTS idx_studio_signals_campaign_id
  ON studio_signals(campaign_id);

CREATE INDEX IF NOT EXISTS idx_studio_signals_status
  ON studio_signals(status, opportunity_score DESC);
