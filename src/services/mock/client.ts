// REST boundary. Every API function goes through `call`, which documents the Flask endpoint it maps to,
// simulates latency, resolves the session from the auth token and enforces authorization like the backend must.
// To go live: replace `call` bodies with fetch(`/api/v1${endpoint}`) – the signatures and payloads stay the same.
import { ApiError, type Permission, type Role, type User } from '@/types';
import { audit, rolePermissions, users, students } from '@/mock/db';

export const API_BASE = '/api/v1';
const KEY = 'ca_session';

export interface Session {
  user: User;
  role: Role;
  permissions: Permission[];
  studentId?: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function storeToken(userId: string, remember: boolean) {
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, userId);
  } catch { /* storage unavailable */ }
}
export function clearToken() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* noop */ }
}
function readToken(): string | null {
  try { return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY); } catch { return null; }
}

export function sessionFor(userId: string | null): Session | null {
  const user = users.find((u) => u.id === userId);
  if (!user || user.status !== 'active') return null;
  return {
    user, role: user.role, permissions: rolePermissions[user.role],
    studentId: user.role === 'student' ? students.find((s) => s.userId === user.id)?.id : undefined,
  };
}

export interface CallOptions { auth?: boolean; delay?: number }

export async function call<T>(method: string, endpoint: string, handler: (s: Session) => T, opts: CallOptions = {}): Promise<T> {
  await sleep(opts.delay ?? 120 + Math.random() * 200);
  const session = sessionFor(readToken());
  if (opts.auth !== false && !session) throw new ApiError(401, 'Your session has expired. Please sign in again.');
  const out = handler(session as Session);
  // structuredClone: UI can never mutate the "database" by reference
  return structuredClone(out);
}

// ---- Authorization guards (server-side equivalents of @require_permission / @require_role) ----
export function requirePerm(s: Session, perm: Permission, resource = 'resource') {
  if (!s.permissions.includes(perm)) {
    audit(s.user.name, s.role, 'access.denied', `${perm} on ${resource}`, 'denied', 'Missing permission');
    throw new ApiError(403, `You do not have permission (${perm}) to do this.`);
  }
}
export function requireAny(s: Session, ...perms: Permission[]) {
  if (!perms.some((p) => s.permissions.includes(p))) {
    audit(s.user.name, s.role, 'access.denied', perms.join(' | '), 'denied', 'Missing permission');
    throw new ApiError(403, 'You do not have permission to view this.');
  }
}
export function requireRole(s: Session, ...roles: Role[]) {
  if (!roles.includes(s.role)) {
    audit(s.user.name, s.role, 'access.denied', `role ${roles.join('|')}`, 'denied', 'Role not allowed');
    throw new ApiError(403, 'This area is not available for your role.');
  }
}
export function requireStudent(s: Session) {
  requireRole(s, 'student');
  const st = students.find((x) => x.id === s.studentId);
  if (!st) throw new ApiError(404, 'Student profile not found.');
  return st;
}
export function notFound(what: string): never { throw new ApiError(404, `${what} not found.`); }

export function paginate<T>(items: T[], page = 1, pageSize = 10) {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}
export const includesCI = (hay: string | undefined, needle: string) => (hay ?? '').toLowerCase().includes(needle.toLowerCase());
