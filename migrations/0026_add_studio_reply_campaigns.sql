ALTER TABLE studio_campaigns
  ADD COLUMN campaign_type TEXT NOT NULL DEFAULT 'post' CHECK(campaign_type IN ('post', 'reply'));

ALTER TABLE studio_crawler_runs
  ADD COLUMN campaign_type TEXT NOT NULL DEFAULT 'post' CHECK(campaign_type IN ('post', 'reply'));

ALTER TABLE studio_strategist_posts
  ADD COLUMN target_url TEXT;

ALTER TABLE studio_strategist_posts
  ADD COLUMN target_external_id TEXT;

ALTER TABLE studio_strategist_posts
  ADD COLUMN target_author TEXT;

ALTER TABLE studio_strategist_posts
  ADD COLUMN target_text TEXT;
