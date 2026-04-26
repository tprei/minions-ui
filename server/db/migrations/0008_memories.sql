CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','archived','pending_deletion')),
  type TEXT NOT NULL CHECK (type IN ('user','feedback','project','reference')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memories_repo_status ON memories(repo, status);
CREATE INDEX IF NOT EXISTS idx_memories_source_session ON memories(source_session_id);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  name,
  description,
  content,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, name, description, content)
  VALUES (new.rowid, new.name, new.description, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  DELETE FROM memories_fts WHERE rowid = old.rowid;
  INSERT INTO memories_fts(rowid, name, description, content)
  VALUES (new.rowid, new.name, new.description, new.content);
END;
