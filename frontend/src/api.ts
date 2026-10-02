import type { ServerHistoryEntry, ServerReport, Status } from './types';
import { clearSession, getToken, type AuthUser } from './auth/session';

// Dev: hit Express directly. Production/desktop: same-origin /api (Express serves UI).
const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.error || res.statusText;
  } catch {
    return res.statusText || 'Request failed';
  }
}

function authHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(
        typeof init.body === 'string' || init.method === 'POST' || init.method === 'PATCH',
      ),
      ...(init.headers || {}),
    },
  });
  if (res.status === 401) {
    clearSession();
  }
  return res;
}

export async function signup(input: {
  email: string;
  name: string;
  password: string;
  manager_key?: string;
}): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await apiFetch('/auth/me');
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  return body.user as AuthUser;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchReports(): Promise<ServerReport[]> {
  const res = await apiFetch('/reports');
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  return body.reports as ServerReport[];
}

export type PendingStatusRequest = {
  id: string;
  report_id: string;
  requested_status: Status;
  request_status: 'pending' | 'approved' | 'rejected';
  requested_by_name?: string;
  note?: string | null;
};

export async function fetchReportDetail(id: string): Promise<{
  report: ServerReport;
  history: ServerHistoryEntry[];
  allowed_transitions: Status[];
  requestable_transitions: Status[];
  pending_request: PendingStatusRequest | null;
}> {
  const res = await apiFetch(`/reports/${id}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function syncReport(payload: {
  client_id: string;
  category: string;
  description: string;
  location: string;
  priority: string;
  status: string;
  reported_at: string;
}): Promise<{ report: ServerReport; created: boolean; message: string }> {
  const res = await apiFetch('/reports', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function patchStatus(
  serverId: string,
  status: Status,
): Promise<{
  report: ServerReport;
  history: ServerHistoryEntry[];
  allowed_transitions: Status[];
  requestable_transitions?: Status[];
  pending_request?: PendingStatusRequest | null;
  message?: string;
}> {
  const res = await apiFetch(`/reports/${serverId}/status`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message = errBody.error || res.statusText;
    throw new Error(message);
  }
  return res.json();
}

export async function fetchStatusRequests(): Promise<PendingStatusRequest[]> {
  const res = await apiFetch('/reports/status-requests');
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  return body.requests as PendingStatusRequest[];
}

export async function reviewStatusRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
): Promise<unknown> {
  const res = await apiFetch(`/reports/status-requests/${requestId}/review`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function syncCentral(): Promise<{
  summary: {
    configured: boolean;
    reachable: boolean;
    pushed: number;
    pulled: number;
    updatedLocal: number;
    updatedCentral: number;
    errors: string[];
  };
  message: string;
}> {
  const res = await apiFetch('/central/sync', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.summary) {
    throw new Error(body.error || (await parseError(res)));
  }
  return body;
}

export async function fetchCentralStatus(): Promise<{
  configured: boolean;
  reachable: boolean;
  urlHost: string | null;
}> {
  const res = await apiFetch('/central/status');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
