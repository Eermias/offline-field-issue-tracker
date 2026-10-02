-- Field Issue Tracker schema
-- client_id is the client-generated UUID used for idempotent synchronization.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE report_category AS ENUM (
    'water_point',
    'equipment',
    'service_interruption',
    'safety',
    'maintenance',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM (
    'draft',
    'submitted',
    'assigned',
    'in_progress',
    'resolved',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE history_event_type AS ENUM (
    'created',
    'status_changed',
    'sync_received',
    'sync_duplicate'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE,
  category report_category NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  priority report_priority NOT NULL,
  status report_status NOT NULL DEFAULT 'submitted',
  reported_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT description_not_empty CHECK (char_length(trim(description)) > 0),
  CONSTRAINT location_not_empty CHECK (char_length(trim(location)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority);
CREATE INDEX IF NOT EXISTS idx_reports_reported_at ON reports(reported_at DESC);

CREATE TABLE IF NOT EXISTS report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  event_type history_event_type NOT NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_history_report_id ON report_history(report_id, created_at ASC);
