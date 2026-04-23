ALTER TABLE sessions ADD COLUMN stage TEXT;
ALTER TABLE sessions ADD COLUMN coordinator_children TEXT;

CREATE INDEX idx_sessions_coordinator_parent ON sessions(parent_id) WHERE parent_id IS NOT NULL;

-- Migrate legacy ship modes to unified ship mode with stage
UPDATE sessions
SET mode = 'ship',
    stage = CASE mode
      WHEN 'ship-think' THEN 'think'
      WHEN 'ship-plan' THEN 'plan'
      WHEN 'ship-verify' THEN 'verify'
      ELSE stage
    END
WHERE mode IN ('ship-think', 'ship-plan', 'ship-verify');
