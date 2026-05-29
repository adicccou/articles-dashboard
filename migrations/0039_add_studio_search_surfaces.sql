ALTER TABLE studio_campaigns ADD COLUMN search_surfaces TEXT NOT NULL DEFAULT '[]';
ALTER TABLE studio_crawler_runs ADD COLUMN search_surfaces TEXT NOT NULL DEFAULT '[]';
