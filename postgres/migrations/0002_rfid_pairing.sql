ALTER TABLE rfid_devices ADD COLUMN hardware_id TEXT;

CREATE UNIQUE INDEX rfid_devices_hardware_id_unique
  ON rfid_devices (hardware_id);

CREATE TABLE rfid_pairing_requests (
  id TEXT PRIMARY KEY NOT NULL,
  hardware_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  device_id TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT
);

CREATE INDEX rfid_pairing_requests_status_expiry_idx
  ON rfid_pairing_requests (status, expires_at);
