CREATE TABLE IF NOT EXISTS session_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  repo TEXT,
  mode TEXT NOT NULL,
  state TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  total_tokens INTEGER,
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_stats_session ON session_stats(session_id);
CREATE INDEX IF NOT EXISTS idx_session_stats_recorded ON session_stats(recorded_at DESC);
