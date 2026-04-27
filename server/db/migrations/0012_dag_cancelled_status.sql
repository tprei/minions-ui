-- Add 'cancelled' to dags.status and dag_nodes.status CHECK constraints.
-- SQLite cannot ALTER a CHECK constraint, so we recreate the tables.

CREATE TABLE dag_nodes_new (
  dag_id TEXT NOT NULL REFERENCES dags(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','skipped','ci-pending','ci-failed','landed','cancelled')),
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  dependencies TEXT NOT NULL DEFAULT '[]',
  dependents TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (dag_id, id)
);

INSERT INTO dag_nodes_new (dag_id, id, slug, status, session_id, dependencies, dependents, payload)
  SELECT dag_id, id, slug, status, session_id, dependencies, dependents, payload FROM dag_nodes;

DROP TABLE dag_nodes;
ALTER TABLE dag_nodes_new RENAME TO dag_nodes;

CREATE INDEX IF NOT EXISTS idx_dag_nodes_session ON dag_nodes(session_id);

CREATE TABLE dags_new (
  id TEXT PRIMARY KEY,
  root_task_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
  repo TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO dags_new (id, root_task_id, status, repo, created_at, updated_at)
  SELECT id, root_task_id, status, repo, created_at, updated_at FROM dags;

DROP TABLE dags;
ALTER TABLE dags_new RENAME TO dags;
