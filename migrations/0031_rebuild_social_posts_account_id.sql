PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS social_posts_rebuilt;

CREATE TABLE social_posts_rebuilt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  posted_at TEXT,
  external_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'dashboard',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  image_url TEXT,
  title TEXT,
  subreddit TEXT,
  account_id INTEGER,
  reply_to_id TEXT
);

INSERT INTO social_posts_rebuilt (
  id,
  user_id,
  platform,
  content,
  status,
  scheduled_at,
  posted_at,
  external_id,
  created_by,
  created_at,
  updated_at,
  image_url,
  title,
  subreddit,
  account_id,
  reply_to_id
)
SELECT
  id,
  user_id,
  platform,
  content,
  status,
  scheduled_at,
  posted_at,
  external_id,
  created_by,
  created_at,
  updated_at,
  image_url,
  title,
  subreddit,
  account_id,
  reply_to_id
FROM social_posts;

DROP TABLE social_posts;

ALTER TABLE social_posts_rebuilt RENAME TO social_posts;

CREATE INDEX IF NOT EXISTS idx_social_posts_user_platform
  ON social_posts(user_id, platform, status, created_at);

PRAGMA foreign_keys = ON;
