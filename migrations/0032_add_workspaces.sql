CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'archived')),
  plan TEXT NOT NULL DEFAULT 'internal',
  owner_user_id INTEGER REFERENCES dashboard_users(id) ON DELETE SET NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO workspaces (
  id,
  slug,
  name,
  status,
  plan,
  owner_user_id,
  timezone,
  created_at,
  updated_at
)
VALUES (
  1,
  'default',
  'Default Workspace',
  'active',
  'internal',
  1,
  'Asia/Kuala_Lumpur',
  datetime('now'),
  datetime('now')
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

INSERT OR IGNORE INTO workspace_members (
  workspace_id,
  user_id,
  role,
  status,
  created_at,
  updated_at
)
SELECT
  1,
  id,
  CASE WHEN role IN ('owner', 'admin') THEN role ELSE 'member' END,
  status,
  datetime('now'),
  datetime('now')
FROM dashboard_users;

CREATE TABLE IF NOT EXISTS workspace_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT,
  token_prefix TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'revoked')),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_agents_workspace_status
  ON workspace_agents(workspace_id, status);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS workspace_usage (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, metric, period_start)
);

ALTER TABLE app_settings ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE app_settings SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_settings_workspace_key
  ON app_settings(workspace_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_settings_workspace_key
  ON app_settings(workspace_id, key);

ALTER TABLE social_accounts ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE social_accounts SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_accounts_workspace_platform
  ON social_accounts(workspace_id, platform, status);

ALTER TABLE social_posts ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE social_posts SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_workspace_platform
  ON social_posts(workspace_id, platform, status, created_at);

ALTER TABLE planner_items ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE planner_items SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_planner_items_workspace_status
  ON planner_items(workspace_id, status, scheduled_for);

ALTER TABLE trading_notes ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE trading_notes SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_trading_notes_workspace_created
  ON trading_notes(workspace_id, created_at);

ALTER TABLE reddit_accounts ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE reddit_accounts SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_reddit_accounts_workspace_status
  ON reddit_accounts(workspace_id, status);

ALTER TABLE reddit_campaigns ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE reddit_campaigns SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_reddit_campaigns_workspace_status
  ON reddit_campaigns(workspace_id, status);

ALTER TABLE threads_campaign_results ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE threads_campaign_results SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_campaign_results_workspace_status
  ON threads_campaign_results(workspace_id, review_status, created_at);

ALTER TABLE studio_apps ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE studio_apps SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_apps_workspace_status
  ON studio_apps(workspace_id, status);

ALTER TABLE studio_campaigns ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE studio_campaigns SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_campaigns_workspace_status
  ON studio_campaigns(workspace_id, status);

ALTER TABLE studio_crawler_runs ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE studio_crawler_runs SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_crawler_runs_workspace_status
  ON studio_crawler_runs(workspace_id, status, created_at);

ALTER TABLE studio_signals ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE studio_signals SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_signals_workspace_status
  ON studio_signals(workspace_id, status, opportunity_score);

ALTER TABLE studio_strategist_posts ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE studio_strategist_posts SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_strategist_posts_workspace_status
  ON studio_strategist_posts(workspace_id, status, created_at);

ALTER TABLE studio_notifications ADD COLUMN workspace_id INTEGER DEFAULT 1;
UPDATE studio_notifications SET workspace_id = 1 WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_notifications_workspace_status
  ON studio_notifications(workspace_id, status, created_at);
