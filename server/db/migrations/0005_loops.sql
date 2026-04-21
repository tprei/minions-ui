CREATE TABLE IF NOT EXISTS loops (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_ms INTEGER NOT NULL,
  last_run_at INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_pr_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
