-- knowledge_base_versions was created with a FK to "knowledge_bases_old"
-- which no longer exists (it was dropped in migration 0012).
-- Recreate the table with the correct FK to the current knowledge_bases table.

PRAGMA foreign_keys=OFF;

ALTER TABLE knowledge_base_versions RENAME TO knowledge_base_versions_old;

CREATE TABLE knowledge_base_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_base_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO knowledge_base_versions (id, knowledge_base_id, version, content, change_summary, created_at)
SELECT id, knowledge_base_id, version, content, change_summary, created_at
FROM knowledge_base_versions_old;

DROP TABLE knowledge_base_versions_old;

CREATE INDEX IF NOT EXISTS idx_knowledge_base_versions_kb_id
  ON knowledge_base_versions(knowledge_base_id);

PRAGMA foreign_keys=ON;
