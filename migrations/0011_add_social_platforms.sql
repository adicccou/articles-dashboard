-- Social accounts (Twitter, Threads, etc.)
CREATE TABLE IF NOT EXISTS social_accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  platform   TEXT NOT NULL,   -- 'twitter' | 'threads' | 'reddit'
  username   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Social posts queue (shared across all platforms)
CREATE TABLE IF NOT EXISTS social_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  platform    TEXT NOT NULL,   -- 'twitter' | 'threads' | 'reddit'
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'approved' | 'scheduled' | 'posted' | 'failed'
  scheduled_at TEXT,
  posted_at   TEXT,
  external_id TEXT,            -- platform post ID after publishing
  created_by  TEXT NOT NULL DEFAULT 'dashboard',  -- 'dashboard' | 'telegram'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Extend app_settings to support Twitter/Threads credentials
-- (no schema change needed — app_settings uses key-value rows)
