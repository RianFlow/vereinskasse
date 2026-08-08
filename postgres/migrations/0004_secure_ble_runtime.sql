ALTER TABLE rfid_devices ADD COLUMN IF NOT EXISTS ble_session_id text;
ALTER TABLE rfid_devices ADD COLUMN IF NOT EXISTS ble_session_counter integer NOT NULL DEFAULT 0;
ALTER TABLE rfid_devices ADD COLUMN IF NOT EXISTS ble_session_expires_at text;
