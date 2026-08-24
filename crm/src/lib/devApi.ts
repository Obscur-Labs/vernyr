import type { UserRole } from '@/types';
import { apiUrl } from './config';

/**
 * Client for the unauthenticated `/api/dev` router. Deliberately not the shared
 * axios instance: that one attaches `crm_token` and bounces to /login on 401,
 * both of which defeat the point of a console you use while logged out.
 */
export async function devApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl}/dev${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { message?: string })?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export interface DevUser {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  role: UserRole;
  phone?: string;
  universityName?: string;
  studentId?: string;
  isActive: boolean;
  lastSeenAt?: string;
  createdAt: string;
}

export interface DevOverview {
  env: {
    nodeEnv: string;
    port: string;
    jwtExpiresIn: string;
    jwtSecretSet: boolean;
    crmUrl: string;
    studentUrl: string;
  };
  storage: { provider: string; configured: boolean; folder: string };
  database: {
    name: string | null;
    readyState: number;
    collections: { name: string; count: number }[];
  };
}

export interface RbacRule {
  area: string;
  surface: string;
  rule: string;
  allow?: string[];
  deny?: string[];
  source: string;
}

export interface DevRbac {
  roles: { role: UserRole; users: number }[];
  matrix: RbacRule[];
}

export interface ImpersonateResult {
  token: string;
  user: DevUser;
  studentId: string | null;
}

export type ActivityAction =
  | 'create' | 'update' | 'delete'
  | 'login' | 'login_failed' | 'register'
  | 'password_reset' | 'impersonate' | 'purge';

export interface ActivityEntry {
  _id: string;
  actorId: string | null;
  actorName: string;
  actorRole?: UserRole;
  action: ActivityAction;
  entity: string;
  entityId?: string;
  label: string;
  changes?: string[];
  source: 'app' | 'dev';
  ip?: string;
  createdAt: string;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  total: number;
  limit: number;
}
