-- SQLite schema for offline / desktop local storage.
-- One file on disk; bundled with the running app's userData directory.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  reported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(description)) > 0),
  CHECK (length(trim(location)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority);
CREATE INDEX IF NOT EXISTS idx_reports_reported_at ON reports(reported_at DESC);

CREATE TABLE IF NOT EXISTS report_history (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_history_report_id
  ON report_history(report_id, created_at ASC);
