import Dexie, { type Table } from 'dexie';
import type { LocalReport } from '../types';

class FieldIssueDB extends Dexie {
  reports!: Table<LocalReport, string>;

  constructor() {
    super('field_issue_tracker');
    this.version(1).stores({
      reports: 'client_id, sync_state, status, reported_at',
    });
  }
}

export const localDb = new FieldIssueDB();

export async function saveLocalReport(report: LocalReport): Promise<void> {
  await localDb.reports.put(report);
}

export async function getAllLocalReports(
  opts?: { userId?: string; role?: 'employee' | 'manager' },
): Promise<LocalReport[]> {
  let reports = await localDb.reports.toArray();
  if (opts?.role === 'employee' && opts.userId) {
    reports = reports.filter((r) => r.created_by === opts.userId);
  }
  return reports.sort(
    (a, b) =>
      new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime(),
  );
}

export async function getLocalReport(
  clientId: string,
): Promise<LocalReport | undefined> {
  return localDb.reports.get(clientId);
}

/** Reports that still need a push to the local API. */
export async function getUnsyncedReports(): Promise<LocalReport[]> {
  return localDb.reports
    .where('sync_state')
    .anyOf(['pending', 'failed'])
    .toArray();
}

/** Mark local-server copies as fully synced to central (Prisma). */
export async function markAllWithServerIdSynchronized(): Promise<void> {
  const reports = await localDb.reports.toArray();
  await Promise.all(
    reports
      .filter((r) => r.server_id && r.sync_state !== 'failed')
      .map((r) =>
        saveLocalReport({
          ...r,
          sync_state: 'synchronized',
          last_sync_error: undefined,
        }),
      ),
  );
}

export async function upsertFromServer(report: {
  id: string;
  client_id: string;
  category: LocalReport['category'];
  description: string;
  location: string;
  priority: LocalReport['priority'];
  status: LocalReport['status'];
  reported_at: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}): Promise<void> {
  const existing = await getLocalReport(report.client_id);
  const merged: LocalReport = {
    client_id: report.client_id,
    server_id: report.id,
    category: report.category,
    description: report.description,
    location: report.location,
    priority: report.priority,
    status: report.status,
    reported_at: report.reported_at,
    created_at: existing?.created_at || report.created_at,
    updated_at: report.updated_at,
    created_by: report.created_by ?? existing?.created_by ?? null,
    // On local server only until central sync confirms
    sync_state:
      existing?.sync_state === 'pending' || existing?.sync_state === 'failed'
        ? existing.sync_state
        : existing?.sync_state === 'synchronized'
          ? 'synchronized'
          : 'unsynced',
    last_sync_error: undefined,
    history: existing?.history || [],
    pending_request_status: existing?.pending_request_status ?? null,
  };
  await saveLocalReport(merged);
}
