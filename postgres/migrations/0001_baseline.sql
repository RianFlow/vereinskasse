CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1d5b4c',
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  must_change_pin SMALLINT NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  recovery_failed_attempts INTEGER NOT NULL DEFAULT 0,
  recovery_locked_until TEXT,
  active SMALLINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE profile_recovery_keys (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE profile_sessions (
  token TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  initials TEXT NOT NULL,
  active SMALLINT NOT NULL DEFAULT 1,
  whatsapp_number TEXT,
  whatsapp_consent_at TEXT
);

CREATE TABLE member_lifecycle (
  member_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  left_at TEXT,
  privacy_review_at TEXT,
  retired_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE rfid_devices (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active SMALLINT NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE rfid_cards (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (profile_id, uid)
);

CREATE TABLE rfid_scans (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  card_type TEXT,
  blocks INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE rfid_write_commands (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  block INTEGER NOT NULL,
  payload_hex TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT
);

CREATE TABLE rfid_display_states (
  profile_id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  customer_name TEXT,
  items_text TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  member_price NUMERIC(12,2),
  included_items_json TEXT NOT NULL DEFAULT '[]',
  is_offer SMALLINT NOT NULL DEFAULT 0,
  icon TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE discount_rules (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  name TEXT NOT NULL,
  percent NUMERIC(6,2) NOT NULL,
  active SMALLINT NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  product_ids_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sales (
  id TEXT PRIMARY KEY NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  items INTEGER NOT NULL,
  time TEXT NOT NULL,
  member TEXT NOT NULL,
  member_id TEXT NOT NULL,
  method TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  event_id TEXT,
  cart_json TEXT NOT NULL,
  backup_key TEXT
);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY NOT NULL,
  sale_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  counts_for_consumption SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE sale_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  sale_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  sale_id TEXT,
  member_id TEXT,
  method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  tendered NUMERIC(12,2),
  change_due NUMERIC(12,2),
  note TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE guest_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id TEXT,
  visit_date TEXT,
  active SMALLINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE rounds (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  sale_id TEXT NOT NULL,
  sponsor_id TEXT NOT NULL,
  sponsor_name TEXT NOT NULL,
  label TEXT NOT NULL,
  total_units INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  max_per_member INTEGER NOT NULL DEFAULT 1,
  active SMALLINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE round_claims (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  round_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  claimed_at TEXT NOT NULL
);

CREATE TABLE shifts (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  opened_by TEXT NOT NULL,
  opened_by_name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opening_cash NUMERIC(12,2) NOT NULL,
  closed_by TEXT,
  closed_at TEXT,
  expected_cash NUMERIC(12,2),
  counted_cash NUMERIC(12,2),
  difference NUMERIC(12,2),
  status TEXT NOT NULL
);

CREATE TABLE reversals (
  id TEXT PRIMARY KEY NOT NULL,
  sale_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE account_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  sale_id TEXT,
  type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE monthly_closures (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  month TEXT NOT NULL,
  statement_number TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  closed_by_name TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  UNIQUE (profile_id, month)
);

CREATE TABLE restore_requests (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  backup_key TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  approved_by TEXT,
  approved_by_name TEXT,
  preview_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE random_reward_campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  name TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  reward_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL,
  remaining_wins INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE random_reward_slots (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'darts',
  campaign_id TEXT NOT NULL,
  trigger_at TEXT NOT NULL,
  claimed_at TEXT,
  sale_id TEXT,
  winner_name TEXT,
  reward_amount NUMERIC(12,2),
  reward_label TEXT
);

CREATE INDEX profile_recovery_keys_profile_active_idx ON profile_recovery_keys (profile_id, used_at, slot);
CREATE INDEX member_lifecycle_status_review_idx ON member_lifecycle (status, privacy_review_at);
CREATE INDEX rfid_devices_profile_active_idx ON rfid_devices (profile_id, active);
CREATE INDEX rfid_cards_profile_member_idx ON rfid_cards (profile_id, member_id);
CREATE INDEX rfid_scans_profile_pending_idx ON rfid_scans (profile_id, consumed_at, created_at);
CREATE INDEX rfid_scans_device_uid_idx ON rfid_scans (device_id, uid, created_at);
CREATE INDEX rfid_write_commands_device_status_idx ON rfid_write_commands (device_id, status, created_at);
CREATE INDEX rfid_write_commands_profile_created_idx ON rfid_write_commands (profile_id, created_at);
CREATE INDEX products_profile_category_idx ON products (profile_id, category);
CREATE INDEX events_profile_status_starts_idx ON events (profile_id, status, starts_at);
CREATE INDEX sales_profile_time_idx ON sales (profile_id, time);
CREATE INDEX sales_profile_event_idx ON sales (profile_id, event_id);
CREATE INDEX sale_items_sale_consumption_idx ON sale_items (sale_id, counts_for_consumption);
CREATE INDEX sale_allocations_profile_sale_member_idx ON sale_allocations (profile_id, sale_id, member_id);
CREATE INDEX payments_profile_member_created_idx ON payments (profile_id, member_id, created_at);
CREATE INDEX guest_accounts_profile_parent_active_idx ON guest_accounts (profile_id, parent_id, active);
CREATE INDEX guest_accounts_profile_visit_idx ON guest_accounts (profile_id, visit_date);
CREATE INDEX round_claims_profile_round_member_idx ON round_claims (profile_id, round_id, member_id);
CREATE INDEX reversals_sale_idx ON reversals (sale_id);
CREATE INDEX account_transactions_profile_member_created_idx ON account_transactions (profile_id, member_id, created_at);
CREATE INDEX account_transactions_sale_idx ON account_transactions (sale_id);
CREATE INDEX restore_requests_profile_status_created_idx ON restore_requests (profile_id, status, created_at);
CREATE INDEX random_reward_campaigns_profile_status_time_idx ON random_reward_campaigns (profile_id, status, starts_at, ends_at);
CREATE INDEX random_reward_slots_profile_campaign_trigger_idx ON random_reward_slots (profile_id, campaign_id, trigger_at);
CREATE INDEX random_reward_slots_sale_idx ON random_reward_slots (sale_id);
