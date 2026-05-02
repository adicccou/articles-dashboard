-- Article categories
CREATE TABLE article_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_article_categories_slug ON article_categories(slug);

-- Add category_id to articles
ALTER TABLE articles ADD COLUMN category_id INTEGER REFERENCES article_categories(id);
CREATE INDEX idx_articles_category_id ON articles(category_id);

-- Reddit accounts
CREATE TABLE reddit_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Reddit campaigns
CREATE TABLE reddit_campaigns (
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
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reddit_campaigns_account_id ON reddit_campaigns(reddit_account_id);
CREATE INDEX idx_reddit_campaigns_status ON reddit_campaigns(status);

-- Reddit comments
CREATE TABLE reddit_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES reddit_campaigns(id) ON DELETE CASCADE,
  reddit_comment_id TEXT NOT NULL UNIQUE,
  subreddit TEXT NOT NULL,
  post_id TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  found_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'replied', 'failed')),
  batch_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reddit_comments_campaign_id ON reddit_comments(campaign_id);
CREATE INDEX idx_reddit_comments_status ON reddit_comments(status);
CREATE INDEX idx_reddit_comments_batch_id ON reddit_comments(batch_id);

-- Reddit reply drafts
CREATE TABLE reddit_reply_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES reddit_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT,
  reddit_reply_id TEXT,
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reddit_reply_drafts_comment_id ON reddit_reply_drafts(comment_id);
CREATE INDEX idx_reddit_reply_drafts_approval_status ON reddit_reply_drafts(approval_status);

-- Approval batches
CREATE TABLE approval_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES reddit_campaigns(id) ON DELETE CASCADE,
  batch_number INTEGER,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  approved_at TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent')),
  telegram_message_id TEXT
);
CREATE INDEX idx_approval_batches_campaign_id ON approval_batches(campaign_id);
