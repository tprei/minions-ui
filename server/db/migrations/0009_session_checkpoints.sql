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
