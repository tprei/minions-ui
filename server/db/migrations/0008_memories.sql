CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'feedback', 'project', 'reference')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'pending_deletion')) DEFAULT 'pending',
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  source_dag_id TEXT REFERENCES dags(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_source_session ON memories(source_session_id);
CREATE INDEX IF NOT EXISTS idx_memories_source_dag ON memories(source_dag_id);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title,
  body,
  content='memories',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts SET title = new.title, body = new.body WHERE rowid = new.id;
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE rowid = old.id;
END;
