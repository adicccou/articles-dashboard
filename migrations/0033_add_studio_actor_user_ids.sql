ALTER TABLE studio_campaigns ADD COLUMN created_by_user_id INTEGER;
UPDATE studio_campaigns
SET created_by_user_id = COALESCE(created_by_user_id, user_id, 1)
WHERE created_by_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_campaigns_created_by_user
  ON studio_campaigns(created_by_user_id, updated_at);

ALTER TABLE studio_crawler_runs ADD COLUMN requested_by_user_id INTEGER;
UPDATE studio_crawler_runs
SET requested_by_user_id = COALESCE(
  requested_by_user_id,
  (SELECT sc.created_by_user_id FROM studio_campaigns sc WHERE sc.id = studio_crawler_runs.campaign_id),
  user_id,
  1
)
WHERE requested_by_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_crawler_runs_requested_by_user
  ON studio_crawler_runs(requested_by_user_id, status, created_at);
