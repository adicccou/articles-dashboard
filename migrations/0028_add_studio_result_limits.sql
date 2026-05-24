ALTER TABLE studio_campaigns
  ADD COLUMN result_limit INTEGER NOT NULL DEFAULT 10;

ALTER TABLE studio_crawler_runs
  ADD COLUMN result_limit INTEGER NOT NULL DEFAULT 10;
