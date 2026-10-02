-- Auth, ownership, and status-change requests (SQLite).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Ownership column (safe to re-run: ignore if already present via app migration helper)
-- Applied in ensureSchema with try/alter for existing DBs.

CREATE TABLE IF NOT EXISTS status_requests (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_status TEXT NOT NULL,
  request_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (request_status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_requests_report
  ON status_requests(report_id, request_status);
CREATE INDEX IF NOT EXISTS idx_status_requests_pending
  ON status_requests(request_status, created_at);
