ALTER TABLE planner_items ADD COLUMN social_post_id INTEGER REFERENCES social_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_planner_items_social_post_id
  ON planner_items(social_post_id);

PRAGMA foreign_keys=OFF;

ALTER TABLE knowledge_bases RENAME TO knowledge_bases_old_v15;

CREATE TABLE knowledge_bases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('reddit_campaign', 'trading_strategy', 'social_platform', 'global')),
  entity_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

INSERT INTO knowledge_bases (id, entity_type, entity_id, title, content, version, created_at, updated_at)
SELECT id, entity_type, entity_id, title, content, version, created_at, updated_at
FROM knowledge_bases_old_v15;

DROP TABLE knowledge_bases_old_v15;

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_entity
  ON knowledge_bases(entity_type, entity_id);

PRAGMA foreign_keys=ON;
