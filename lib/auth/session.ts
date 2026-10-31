import { randomBytes } from "node:crypto";
import type { AuthChain } from "./challenge";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "myntle_session";

type Session = {
  chain: AuthChain;
  address: string;
  createdAt: number;
  expiresAt: number;
};

const globalStore = globalThis as unknown as {
  __myntle_sessions?: Map<string, Session>;
};

function store(): Map<string, Session> {
  if (!globalStore.__myntle_sessions) {
    globalStore.__myntle_sessions = new Map();
  }
  return globalStore.__myntle_sessions;
}

export function createSession(chain: AuthChain, address: string): {
  id: string;
  expiresAt: number;
} {
  const id = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  store().set(id, { chain, address, createdAt: now, expiresAt });
  return { id, expiresAt };
}

export function getSession(id: string): Session | null {
  const session = store().get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    store().delete(id);
    return null;
  }
  return session;
}

export function revokeSession(id: string): void {
  store().delete(id);
}
