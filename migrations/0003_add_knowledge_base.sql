-- Knowledge base tables (shared by Reddit and Trading)
CREATE TABLE knowledge_bases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('reddit_campaign', 'trading_strategy')),
  entity_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX idx_knowledge_bases_entity ON knowledge_bases(entity_type, entity_id);

-- Knowledge base version history
CREATE TABLE knowledge_base_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_base_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_knowledge_base_versions_kb_id ON knowledge_base_versions(knowledge_base_id);

-- Add knowledge_base_id to reddit_campaigns for reference
ALTER TABLE reddit_campaigns ADD COLUMN knowledge_base_id INTEGER REFERENCES knowledge_bases(id) ON DELETE SET NULL;

CREATE INDEX idx_reddit_campaigns_kb_id ON reddit_campaigns(knowledge_base_id);
