PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','waiting_input','completed','failed')),
  command TEXT NOT NULL,
  mode TEXT NOT NULL,
  repo TEXT,
  branch TEXT,
  pr_url TEXT,
  parent_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  variant_group_id TEXT,
  claude_session_id TEXT,
  workspace_root TEXT,
  bare_dir TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  needs_attention INTEGER NOT NULL DEFAULT 0,
  attention_reasons TEXT NOT NULL DEFAULT '[]',
  quick_actions TEXT NOT NULL DEFAULT '[]',
  conversation TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

CREATE TABLE IF NOT EXISTS external_tasks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('github_issue','github_pr_comment','linear_issue','slack_thread')),
  external_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('started','failed')),
  repo TEXT,
  mode TEXT NOT NULL,
  title TEXT,
  url TEXT,
  author TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_tasks_session ON external_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_external_tasks_source ON external_tasks(source, updated_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_session ON audit_events(session_id);

CREATE TABLE IF NOT EXISTS session_events (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  turn INTEGER NOT NULL,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_session_events_turn ON session_events(session_id, turn);

CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turn','completion','manual')),
  label TEXT NOT NULL,
  sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  branch TEXT,
  dag_id TEXT,
  dag_node_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session ON session_checkpoints(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_checkpoints_dag_node ON session_checkpoints(dag_id, dag_node_id);

CREATE TABLE IF NOT EXISTS dags (
  id TEXT PRIMARY KEY,
  root_task_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  repo TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dag_nodes (
  dag_id TEXT NOT NULL REFERENCES dags(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','skipped','ci-pending','ci-failed','landed')),
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  dependencies TEXT NOT NULL DEFAULT '[]',
  dependents TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (dag_id, id)
);

CREATE INDEX IF NOT EXISTS idx_dag_nodes_session ON dag_nodes(session_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  expiration_time INTEGER,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vapid_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS github_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

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
