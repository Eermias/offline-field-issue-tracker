import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  fetchCentralStatus,
  fetchReportDetail,
  fetchStatusRequests,
  healthCheck,
  patchStatus,
  reviewStatusRequest,
  syncCentral,
  type PendingStatusRequest,
} from './api';
import { AuthScreen } from './auth/AuthScreen';
import {
  clearSession,
  getStoredUser,
  getToken,
  type AuthUser,
} from './auth/session';
import {
  getAllLocalReports,
  getLocalReport,
  markAllWithServerIdSynchronized,
  saveLocalReport,
} from './db/indexedDb';
import { pullServerReports, synchronizePending } from './sync/syncService';
import type { Category, LocalReport, Priority, Status } from './types';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  PRIORITIES,
  STATUS_LABELS,
  SYNC_STATE_LABELS,
} from './types';
import './styles/app.css';

type FormState = {
  category: Category;
  description: string;
  location: string;
  priority: Priority;
  status: 'draft' | 'submitted';
};

const emptyForm: FormState = {
  category: 'water_point',
  description: '',
  location: '',
  priority: 'medium',
  status: 'submitted',
};

const AUTO_SYNC_MS = 20_000;
const CONNECTIVITY_MS = 1_500;

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

async function probeOnline(): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (!getToken()) {
    return healthCheck();
  }
  try {
    const status = await fetchCentralStatus();
    if (status.configured) return status.reachable;
  } catch {
    return healthCheck();
  }
  return navigator.onLine;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [reports, setReports] = useState<LocalReport[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<LocalReport | null>(null);
  const [serverHistory, setServerHistory] = useState<
    { event_type: string; message: string | null; created_at: string }[]
  >([]);
  const [allowedTransitions, setAllowedTransitions] = useState<Status[]>([]);
  const [requestableTransitions, setRequestableTransitions] = useState<
    Status[]
  >([]);
  const [pendingRequest, setPendingRequest] =
    useState<PendingStatusRequest | null>(null);
  const [managerQueue, setManagerQueue] = useState<PendingStatusRequest[]>([]);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastCentralMsg, setLastCentralMsg] = useState<string | null>(null);

  const selectedIdRef = useRef<string | null>(null);
  const userRef = useRef<AuthUser | null>(user);
  const syncInFlight = useRef(false);
  const wasOnline = useRef(false);
  selectedIdRef.current = selectedId;
  userRef.current = user;

  const pendingCount = useMemo(
    () => reports.filter((r) => r.sync_state !== 'synchronized').length,
    [reports],
  );

  const isManager = user?.role === 'manager';

  async function refreshList() {
    const current = userRef.current;
    setReports(
      await getAllLocalReports(
        current
          ? { userId: current.id, role: current.role }
          : undefined,
      ),
    );
  }

  async function refreshManagerQueue() {
    if (userRef.current?.role !== 'manager' || !getToken()) {
      setManagerQueue([]);
      return;
    }
    try {
      setManagerQueue(await fetchStatusRequests());
    } catch {
      setManagerQueue([]);
    }
  }

  async function loadDetail(clientId: string, isOnline = online) {
    const local = await getLocalReport(clientId);
    setSelected(local || null);
    setSelectedId(clientId);
    setServerHistory([]);
    setAllowedTransitions([]);
    setRequestableTransitions([]);
    setPendingRequest(null);

    if (local?.server_id && isOnline && getToken()) {
      try {
        const detail = await fetchReportDetail(local.server_id);
        setServerHistory(detail.history);
        setAllowedTransitions(detail.allowed_transitions || []);
        setRequestableTransitions(detail.requestable_transitions || []);
        setPendingRequest(detail.pending_request);
        const updated: LocalReport = {
          ...local,
          status: detail.report.status,
          updated_at: detail.report.updated_at,
          created_by: detail.report.created_by ?? local.created_by,
          pending_request_status:
            detail.pending_request?.requested_status ?? null,
        };
        await saveLocalReport(updated);
        setSelected(updated);
        await refreshList();
      } catch {
        // show local only
      }
    }
  }

  const runFullSync = useCallback(
    async (opts?: { announce?: boolean; reason?: string }) => {
      if (syncInFlight.current || !getToken()) return null;

      const reachable = await probeOnline();
      setOnline(reachable);
      if (!reachable) return null;

      syncInFlight.current = true;
      setSyncing(true);
      if (opts?.announce) setBanner(opts.reason ?? 'Syncing…');

      try {
        await pullServerReports();
        const summary = await synchronizePending();

        let centralOk = false;
        let centralMsg = '';
        try {
          const central = await syncCentral();
          if (!central.summary.configured) {
            centralMsg = 'Central DB not configured';
          } else if (!central.summary.reachable) {
            centralMsg = 'Central DB unreachable';
            setOnline(false);
          } else if (central.summary.errors.length) {
            centralMsg = `Central errors (${central.summary.errors.length})`;
          } else {
            centralOk = true;
            centralMsg = `Central pushed ${central.summary.pushed}, pulled ${central.summary.pulled}`;
          }
        } catch {
          centralMsg = 'Central sync failed';
        }

        if (centralOk) await markAllWithServerIdSynchronized();

        setLastCentralMsg(centralMsg);
        await refreshList();
        await refreshManagerQueue();
        if (selectedIdRef.current) {
          await loadDetail(selectedIdRef.current, centralOk || reachable);
        }

        if (opts?.announce) {
          setBanner(
            `Sync finished: ${summary.succeeded} local, ${summary.failed} failed · ${centralMsg}`,
          );
        }
        return summary;
      } catch (error) {
        setOnline(false);
        await refreshList();
        if (opts?.announce) {
          setBanner(error instanceof Error ? error.message : 'Sync failed');
        }
        return null;
      } finally {
        syncInFlight.current = false;
        setSyncing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!user) return;

    void refreshList();
    void refreshManagerQueue();

    const applyConnectivity = async (announceTransition: boolean) => {
      const reachable = await probeOnline();
      const previously = wasOnline.current;
      wasOnline.current = reachable;
      setOnline(reachable);

      if (!reachable) {
        if (announceTransition && previously) {
          setBanner('You are offline. New reports will be saved locally.');
        }
        return;
      }

      if (announceTransition && !previously) {
        await runFullSync({
          announce: true,
          reason: 'Back online — syncing…',
        });
      } else if (!previously) {
        await runFullSync({ announce: false });
      }
    };

    void applyConnectivity(false);

    const onBrowserOnline = () => void applyConnectivity(true);
    const onBrowserOffline = () => {
      wasOnline.current = false;
      setOnline(false);
      setBanner('You are offline. New reports will be saved locally.');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void applyConnectivity(true);
      }
    };

    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
    document.addEventListener('visibilitychange', onVisibility);

    const connectivityTimer = window.setInterval(() => {
      void applyConnectivity(true);
    }, CONNECTIVITY_MS);

    const syncTimer = window.setInterval(() => {
      if (wasOnline.current) void runFullSync({ announce: false });
    }, AUTO_SYNC_MS);

    return () => {
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(connectivityTimer);
      window.clearInterval(syncTimer);
    };
  }, [user, runFullSync]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    if (!form.description.trim() || !form.location.trim()) {
      setFormError('Description and location are required.');
      return;
    }

    const now = new Date().toISOString();
    const report: LocalReport = {
      client_id: uuidv4(),
      category: form.category,
      description: form.description.trim(),
      location: form.location.trim(),
      priority: form.priority,
      status: form.status,
      reported_at: now,
      created_at: now,
      updated_at: now,
      sync_state: 'pending',
      created_by: user.id,
      history: [
        {
          id: uuidv4(),
          event_type: 'created',
          message: online
            ? 'Report created locally (pending sync)'
            : 'Report created offline',
          created_at: now,
        },
      ],
    };

    try {
      await saveLocalReport(report);
      setForm(emptyForm);
      setBanner(
        online
          ? 'Report saved — syncing…'
          : 'Report saved offline (pending sync).',
      );
      await refreshList();
      setSelectedId(report.client_id);
      setSelected(report);
      if (online) {
        await runFullSync({ announce: true, reason: 'Syncing new report…' });
      }
    } catch {
      setFormError('Could not save report to local storage.');
    }
  }

  async function handleStatusAction(next: Status) {
    if (!selected?.server_id || !user) {
      setBanner('Synchronize the report before changing status.');
      return;
    }
    try {
      const result = await patchStatus(selected.server_id, next);
      const updated: LocalReport = {
        ...selected,
        status: result.report.status,
        updated_at: result.report.updated_at,
        sync_state: isManager ? 'unsynced' : selected.sync_state,
        pending_request_status:
          result.pending_request?.requested_status ?? null,
        history: [
          ...selected.history,
          {
            id: uuidv4(),
            event_type: isManager ? 'status_changed' : 'status_requested',
            message: isManager
              ? `Status changed to ${next}`
              : `Requested status change to ${next}`,
            created_at: new Date().toISOString(),
          },
        ],
      };
      await saveLocalReport(updated);
      setSelected(updated);
      setServerHistory(result.history);
      setAllowedTransitions(result.allowed_transitions || []);
      setRequestableTransitions(result.requestable_transitions || []);
      setPendingRequest(result.pending_request ?? null);
      await refreshList();
      await refreshManagerQueue();
      setBanner(
        result.message ||
          (isManager
            ? `Status updated to ${STATUS_LABELS[next]}.`
            : `Requested ${STATUS_LABELS[next]} — awaiting manager approval.`),
      );
      if (online && isManager) void runFullSync({ announce: false });
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Status update failed');
    }
  }

  async function handleReview(
    requestId: string,
    decision: 'approved' | 'rejected',
  ) {
    try {
      await reviewStatusRequest(requestId, decision);
      setBanner(
        decision === 'approved'
          ? 'Status request approved.'
          : 'Status request rejected.',
      );
      await refreshManagerQueue();
      if (selectedId) await loadDetail(selectedId, online);
      if (online) void runFullSync({ announce: false });
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Review failed');
    }
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setReports([]);
    setSelected(null);
    setSelectedId(null);
    setManagerQueue([]);
  }

  if (!user || !getToken()) {
    return (
      <AuthScreen
        onAuthenticated={(next) => {
          setUser(next);
          setBanner(`Signed in as ${next.name} (${next.role}).`);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div
            className="logo-wrap"
            title={online ? 'App open — Online' : 'App open — Offline'}
          >
            <img className="logo" src="/logo.svg" alt="Field Issue Tracker" />
            <span
              className={`logo-dot ${online ? '' : 'offline'}`}
              aria-hidden="true"
            />
          </div>
          <div className="brand-copy">
            <h1>Field Issue Tracker</h1>
            <p className="subtitle">
              {user.name} · {user.role === 'manager' ? 'Manager' : 'Employee'}
            </p>
          </div>
        </div>
        <div className="header-actions">
          <span className={`pill ${online ? 'pill-online' : 'pill-offline'}`}>
            {online ? 'Online' : 'Offline'}
          </span>
          <span className="pill">{pendingCount} pending</span>
          <span
            className={`sync-indicator ${syncing ? 'is-syncing' : ''}`}
            title={
              syncing
                ? 'Syncing local + central…'
                : lastCentralMsg || 'Auto-sync idle'
            }
            aria-live="polite"
          >
            <span className="spinner" aria-hidden="true" />
            <span className="sync-indicator-label">
              {syncing ? 'Syncing' : online ? 'Synced' : 'Waiting'}
            </span>
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void runFullSync({ announce: true, reason: 'Syncing…' })
            }
            disabled={!online || syncing}
          >
            Sync Now
          </button>
          <button type="button" className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {banner && (
        <div className="banner" role="status">
          {banner}
          <button
            type="button"
            className="linkish"
            onClick={() => setBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {isManager && managerQueue.length > 0 && (
        <section className="panel queue-panel">
          <h2>Status requests</h2>
          <ul className="request-list">
            {managerQueue.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>
                    {STATUS_LABELS[r.requested_status] || r.requested_status}
                  </strong>
                  <span className="muted">
                    {' '}
                    requested by {r.requested_by_name || 'employee'}
                  </span>
                  <span className="sync sync-pending">Requested</span>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => void handleReview(r.id, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void handleReview(r.id, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <main className="layout">
        <section className="panel">
          <h2>New report</h2>
          <form onSubmit={(e) => void handleCreate(e)} className="form">
            <label>
              Category
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as Category })
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Priority
              <select
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as Priority })
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Initial status
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as 'draft' | 'submitted',
                  })
                }
              >
                <option value="submitted">Submitted</option>
                <option value="draft">Draft</option>
              </select>
            </label>

            <label>
              Location
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Sector 4 standpipe"
              />
            </label>

            <label>
              Description
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={4}
                placeholder="Describe the issue"
              />
            </label>

            {formError && <p className="error">{formError}</p>}
            <button type="submit" disabled={syncing}>
              Save report
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>{isManager ? 'All reports' : 'My reports'}</h2>
          <ul className="report-list">
            {reports.length === 0 && (
              <li className="muted">No reports yet.</li>
            )}
            {reports.map((r) => (
              <li key={r.client_id}>
                <button
                  type="button"
                  className={`report-row ${
                    selectedId === r.client_id ? 'active' : ''
                  }`}
                  onClick={() => void loadDetail(r.client_id)}
                >
                  <div className="report-row-top">
                    <strong>{CATEGORY_LABELS[r.category]}</strong>
                    <span className={`sync sync-${r.sync_state}`}>
                      {SYNC_STATE_LABELS[r.sync_state]}
                    </span>
                  </div>
                  <div className="report-row-meta">
                    <span>{STATUS_LABELS[r.status]}</span>
                    {r.pending_request_status && (
                      <span className="sync sync-pending">
                        Requested ? {STATUS_LABELS[r.pending_request_status]}
                      </span>
                    )}
                    <span>{r.priority}</span>
                    <span>{r.location}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Details</h2>
          {!selected && (
            <p className="muted">Select a report to view details.</p>
          )}
          {selected && (
            <div className="detail">
              <p>
                <strong>Category:</strong> {CATEGORY_LABELS[selected.category]}
              </p>
              <p>
                <strong>Location:</strong> {selected.location}
              </p>
              <p>
                <strong>Priority:</strong> {selected.priority}
              </p>
              <p>
                <strong>Status:</strong> {STATUS_LABELS[selected.status]}
              </p>
              {pendingRequest && (
                <p>
                  <strong>Request:</strong>{' '}
                  <span className="sync sync-pending">
                    Requested ? {STATUS_LABELS[pendingRequest.requested_status]}
                  </span>
                </p>
              )}
              <p>
                <strong>Sync:</strong>{' '}
                <span className={`sync sync-${selected.sync_state}`}>
                  {SYNC_STATE_LABELS[selected.sync_state]}
                </span>
              </p>
              {selected.last_sync_error && (
                <p className="error">
                  Last sync error: {selected.last_sync_error}
                </p>
              )}
              <p>
                <strong>Reported:</strong>{' '}
                {new Date(selected.reported_at).toLocaleString()}
              </p>
              <p>
                <strong>Description:</strong>
              </p>
              <p>{selected.description}</p>
              <p className="muted small">
                Client ID: {selected.client_id}
                {selected.server_id
                  ? ` · Server ID: ${selected.server_id}`
                  : ''}
              </p>

              {isManager &&
                selected.server_id &&
                allowedTransitions.length > 0 && (
                  <div className="transitions">
                    <h3>Change status</h3>
                    <div className="button-row">
                      {allowedTransitions.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => void handleStatusAction(t)}
                        >
                          ? {STATUS_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {!isManager &&
                selected.server_id &&
                !pendingRequest &&
                requestableTransitions.length > 0 && (
                  <div className="transitions">
                    <h3>Request status change</h3>
                    <p className="muted small">
                      A manager must approve before the status updates.
                    </p>
                    <div className="button-row">
                      {requestableTransitions.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="secondary"
                          onClick={() => void handleStatusAction(t)}
                        >
                          Request {STATUS_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {!isManager && pendingRequest && (
                <p className="muted">
                  Waiting for manager approval to move to{' '}
                  <strong>
                    {STATUS_LABELS[pendingRequest.requested_status]}
                  </strong>
                  .
                </p>
              )}

              <h3>History</h3>
              <ul className="history">
                {selected.history.map((h) => (
                  <li key={h.id}>
                    <span className="history-type">
                      {formatLabel(h.event_type)}
                    </span>
                    <span>{h.message}</span>
                    <span className="muted small">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
                {serverHistory.map((h) => (
                  <li key={`server-${h.created_at}-${h.event_type}`}>
                    <span className="history-type">
                      server · {formatLabel(h.event_type)}
                    </span>
                    <span>{h.message}</span>
                    <span className="muted small">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
