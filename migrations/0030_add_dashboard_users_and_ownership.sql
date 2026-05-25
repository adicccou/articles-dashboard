CREATE TABLE IF NOT EXISTS dashboard_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO dashboard_users (
  id,
  username,
  display_name,
  role,
  status,
  timezone,
  created_at,
  updated_at
)
VALUES (
  1,
  'admin',
  'admin',
  'owner',
  'active',
  'Asia/Kuala_Lumpur',
  datetime('now'),
  datetime('now')
);

CREATE TABLE IF NOT EXISTS app_settings_user_owned (
  user_id INTEGER NOT NULL DEFAULT 1 REFERENCES dashboard_users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

INSERT OR IGNORE INTO app_settings_user_owned (user_id, key, value, updated_at)
SELECT 1, key, value, updated_at
FROM app_settings;

DROP TABLE app_settings;

ALTER TABLE app_settings_user_owned RENAME TO app_settings;

CREATE INDEX IF NOT EXISTS idx_app_settings_user_id
  ON app_settings(user_id);

ALTER TABLE social_accounts ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE social_accounts SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_accounts_user_platform
  ON social_accounts(user_id, platform, status);

ALTER TABLE social_posts ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE social_posts SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_user_platform
  ON social_posts(user_id, platform, status, created_at);

ALTER TABLE planner_items ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE planner_items SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_planner_items_user_status
  ON planner_items(user_id, status, scheduled_for);

ALTER TABLE trading_notes ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE trading_notes SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_trading_notes_user_created
  ON trading_notes(user_id, created_at);

ALTER TABLE reddit_accounts ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE reddit_accounts SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_reddit_accounts_user_status
  ON reddit_accounts(user_id, status);

ALTER TABLE reddit_campaigns ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE reddit_campaigns SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_reddit_campaigns_user_status
  ON reddit_campaigns(user_id, status);

ALTER TABLE threads_campaign_results ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE threads_campaign_results SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_campaign_results_user_status
  ON threads_campaign_results(user_id, review_status, created_at);

ALTER TABLE studio_apps ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE studio_apps SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_apps_user_status
  ON studio_apps(user_id, status);

ALTER TABLE studio_campaigns ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE studio_campaigns SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_campaigns_user_status
  ON studio_campaigns(user_id, status);

ALTER TABLE studio_crawler_runs ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE studio_crawler_runs SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_crawler_runs_user_status
  ON studio_crawler_runs(user_id, status, created_at);

ALTER TABLE studio_signals ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE studio_signals SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_signals_user_status
  ON studio_signals(user_id, status, opportunity_score);

ALTER TABLE studio_strategist_posts ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE studio_strategist_posts SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_strategist_posts_user_status
  ON studio_strategist_posts(user_id, status, created_at);

ALTER TABLE studio_notifications ADD COLUMN user_id INTEGER DEFAULT 1;
UPDATE studio_notifications SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_notifications_user_status
  ON studio_notifications(user_id, status, created_at);
