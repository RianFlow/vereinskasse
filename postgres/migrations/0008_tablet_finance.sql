CREATE TABLE tablet_funds (
 id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, label TEXT NOT NULL,
 sponsor_id TEXT NOT NULL, sponsor_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('cash','once')),
 state TEXT NOT NULL CHECK(state IN ('active','paused','closed')),
 budget_cents INTEGER NOT NULL DEFAULT 0 CHECK(budget_cents>=0),
 spent_cents INTEGER NOT NULL DEFAULT 0 CHECK(spent_cents>=0),
 refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0),
 revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(kind='once' OR spent_cents+refunded_cents<=budget_cents)
);
CREATE UNIQUE INDEX tablet_funds_open_idx ON tablet_funds(profile_id) WHERE state IN ('active','paused');
CREATE TABLE tablet_operations (
 id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, kind TEXT NOT NULL,
 request_hash TEXT NOT NULL, undo_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at TEXT NOT NULL, undone_at TEXT
);
CREATE INDEX tablet_operations_profile_idx ON tablet_operations(profile_id,created_at);
