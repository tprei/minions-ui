CREATE TABLE IF NOT EXISTS dag_deferred_restacks (
  id TEXT PRIMARY KEY,
  dag_id TEXT NOT NULL REFERENCES dags(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  parent_sha TEXT NOT NULL,
  new_sha TEXT NOT NULL,
  cascade_depth INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dag_deferred_restacks_session ON dag_deferred_restacks(session_id);
CREATE INDEX IF NOT EXISTS idx_dag_deferred_restacks_dag ON dag_deferred_restacks(dag_id);
