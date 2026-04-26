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
