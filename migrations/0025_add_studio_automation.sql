CREATE TABLE IF NOT EXISTS studio_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  website_url TEXT,
  app_store_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  ai_context TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_apps_status
  ON studio_apps(status);

CREATE TABLE IF NOT EXISTS studio_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES studio_apps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_refs TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_campaigns_app_id
  ON studio_campaigns(app_id);

CREATE INDEX IF NOT EXISTS idx_studio_campaigns_status
  ON studio_campaigns(status);

CREATE TABLE IF NOT EXISTS studio_crawler_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES studio_campaigns(id) ON DELETE SET NULL,
  app_id INTEGER NOT NULL REFERENCES studio_apps(id) ON DELETE CASCADE,
  account_refs TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  crawler_summary TEXT,
  raw_data TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_crawler_runs_status
  ON studio_crawler_runs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_studio_crawler_runs_campaign_id
  ON studio_crawler_runs(campaign_id);

CREATE TABLE IF NOT EXISTS studio_strategist_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawler_run_id INTEGER NOT NULL REFERENCES studio_crawler_runs(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES studio_campaigns(id) ON DELETE SET NULL,
  app_id INTEGER NOT NULL REFERENCES studio_apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  post_text TEXT NOT NULL,
  idea TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none' CHECK(media_type IN ('none', 'photo', 'video')),
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested', 'asset_needed', 'scheduled', 'posted', 'dismissed')),
  social_post_id INTEGER REFERENCES social_posts(id) ON DELETE SET NULL,
  planner_item_id INTEGER REFERENCES planner_items(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_strategist_posts_run_id
  ON studio_strategist_posts(crawler_run_id);

CREATE INDEX IF NOT EXISTS idx_studio_strategist_posts_status
  ON studio_strategist_posts(status);

CREATE TABLE IF NOT EXISTS studio_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
  text TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_notifications_status
  ON studio_notifications(status, created_at);
