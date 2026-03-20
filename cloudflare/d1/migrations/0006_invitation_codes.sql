CREATE TABLE IF NOT EXISTS invitation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_by_company_id TEXT,
  FOREIGN KEY (used_by_company_id) REFERENCES companies(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_status
ON invitation_codes (used_at, created_at DESC);
