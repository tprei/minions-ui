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

CREATE TABLE IF NOT EXISTS dags (
  id TEXT PRIMARY KEY,
  root_task_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
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
