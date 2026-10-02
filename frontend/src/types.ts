export const CATEGORIES = [
  'water_point',
  'equipment',
  'service_interruption',
  'safety',
  'maintenance',
  'other',
] as const;

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export const STATUSES = [
  'draft',
  'submitted',
  'assigned',
  'in_progress',
  'resolved',
  'rejected',
] as const;

export const SYNC_STATES = [
  'pending',
  'unsynced',
  'synchronized',
  'failed',
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];
export type SyncState = (typeof SYNC_STATES)[number];

export interface LocalHistoryEntry {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

/** Local report stored in IndexedDB (source of truth while offline). */
export interface LocalReport {
  client_id: string;
  server_id?: string;
  category: Category;
  description: string;
  location: string;
  priority: Priority;
  status: Status;
  reported_at: string;
  created_at: string;
  updated_at: string;
  sync_state: SyncState;
  last_sync_error?: string;
  history: LocalHistoryEntry[];
  created_by?: string | null;
  pending_request_status?: Status | null;
}

export interface ServerReport {
  id: string;
  client_id: string;
  category: Category;
  description: string;
  location: string;
  priority: Priority;
  status: Status;
  reported_at: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export interface ServerHistoryEntry {
  id: string;
  report_id: string;
  event_type: string;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  water_point: 'Water point',
  equipment: 'Equipment',
  service_interruption: 'Service interruption',
  safety: 'Safety',
  maintenance: 'Maintenance',
  other: 'Other',
};

export const STATUS_LABELS: Record<Status, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

export const SYNC_STATE_LABELS: Record<SyncState, string> = {
  pending: 'Pending',
  unsynced: 'Unsynced',
  synchronized: 'Synchronized',
  failed: 'Failed',
};
