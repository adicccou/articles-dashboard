CREATE TABLE IF NOT EXISTS threads_campaign_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES planner_items(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES social_accounts(id) ON DELETE SET NULL,
  search_query TEXT NOT NULL,
  media_id TEXT NOT NULL,
  username TEXT,
  media_text TEXT,
  permalink TEXT,
  media_type TEXT,
  published_at TEXT,
  review_status TEXT NOT NULL DEFAULT 'new'
    CHECK (review_status IN ('new', 'reviewed', 'dismissed', 'replied', 'drafted')),
  suggested_reply TEXT,
  suggested_post TEXT,
  suggestion_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_threads_campaign_results_campaign
  ON threads_campaign_results(campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threads_campaign_results_status
  ON threads_campaign_results(review_status, created_at DESC);
