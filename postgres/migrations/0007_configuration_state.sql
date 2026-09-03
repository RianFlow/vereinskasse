-- Shared optimistic revision for POS and backoffice catalogue writes.
CREATE TABLE IF NOT EXISTS configuration_state (
  profile_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  last_mutation TEXT NOT NULL DEFAULT ''
);
