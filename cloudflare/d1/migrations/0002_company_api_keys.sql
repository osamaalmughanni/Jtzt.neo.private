PRAGMA foreign_keys = ON;

ALTER TABLE companies ADD COLUMN api_key_hash TEXT;
ALTER TABLE companies ADD COLUMN api_key_created_at TEXT;
