ALTER TABLE planner_items ADD COLUMN account_id INTEGER;
ALTER TABLE planner_items ADD COLUMN instruction TEXT;
ALTER TABLE planner_items ADD COLUMN interval_minutes INTEGER;
ALTER TABLE planner_items ADD COLUMN duration_start TEXT;
ALTER TABLE planner_items ADD COLUMN duration_end TEXT;

ALTER TABLE reddit_campaigns ADD COLUMN start_at TEXT;
ALTER TABLE reddit_campaigns ADD COLUMN end_at TEXT;
