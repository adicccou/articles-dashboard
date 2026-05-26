PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS reddit_campaigns_rebuilt;

CREATE TABLE reddit_campaigns_rebuilt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reddit_account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  subreddit TEXT NOT NULL,
  search_query TEXT NOT NULL,
  search_criteria TEXT NOT NULL,
  agent_instructions TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused')),
  approval_method TEXT DEFAULT 'batch' CHECK (approval_method IN ('batch', 'immediate')),
  batch_size INTEGER DEFAULT 10,
  batch_window_hours INTEGER DEFAULT 24,
  throttle_enabled INTEGER DEFAULT 1,
  throttle_interval_minutes INTEGER DEFAULT 60,
  telegram_chat_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  knowledge_base_id INTEGER REFERENCES knowledge_bases(id) ON DELETE SET NULL,
  start_at TEXT,
  end_at TEXT,
  user_id INTEGER DEFAULT 1,
  workspace_id INTEGER DEFAULT 1
);

INSERT INTO reddit_campaigns_rebuilt (
  id,
  reddit_account_id,
  name,
  description,
  subreddit,
  search_query,
  search_criteria,
  agent_instructions,
  status,
  approval_method,
  batch_size,
  batch_window_hours,
  throttle_enabled,
  throttle_interval_minutes,
  telegram_chat_id,
  created_at,
  updated_at,
  knowledge_base_id,
  start_at,
  end_at,
  user_id,
  workspace_id
)
SELECT
  id,
  reddit_account_id,
  name,
  description,
  subreddit,
  search_query,
  search_criteria,
  agent_instructions,
  status,
  approval_method,
  batch_size,
  batch_window_hours,
  throttle_enabled,
  throttle_interval_minutes,
  telegram_chat_id,
  created_at,
  updated_at,
  knowledge_base_id,
  start_at,
  end_at,
  user_id,
  workspace_id
FROM reddit_campaigns;

DROP TABLE reddit_campaigns;

ALTER TABLE reddit_campaigns_rebuilt RENAME TO reddit_campaigns;

CREATE INDEX IF NOT EXISTS idx_reddit_campaigns_account_id
  ON reddit_campaigns(reddit_account_id);

CREATE INDEX IF NOT EXISTS idx_reddit_campaigns_status
  ON reddit_campaigns(status);

CREATE INDEX IF NOT EXISTS idx_reddit_campaigns_kb_id
  ON reddit_campaigns(knowledge_base_id);

CREATE INDEX IF NOT EXISTS idx_reddit_campaigns_user_status
  ON reddit_campaigns(user_id, status);

CREATE INDEX IF NOT EXISTS idx_reddit_campaigns_workspace_status
  ON reddit_campaigns(workspace_id, status);

PRAGMA foreign_keys = ON;
