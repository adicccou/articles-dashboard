ALTER TABLE planner_items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'post' CHECK (item_type IN ('post', 'campaign'));

CREATE INDEX idx_planner_items_item_type ON planner_items(item_type);
