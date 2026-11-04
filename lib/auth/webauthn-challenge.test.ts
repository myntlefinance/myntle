import { beforeEach, describe, expect, it, vi } from "vitest";

type ChallengeRow = {
  id: string;
  kind: string;
  user_id: string | null;
  challenge: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type Filter = {
  col: string;
  op: "eq" | "is" | "gt" | "lt";
  value: unknown;
};

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  seq: 0,
}));

vi.mock("@/lib/db/client", () => {
  const rows = () => state.rows as ChallengeRow[];

  const matches = (row: ChallengeRow, filters: Filter[]): boolean =>
    filters.every(({ col, op, value }) => {
      const current = (row as unknown as Record<string, unknown>)[col];
      if (op === "eq") return current === value;
      if (op === "is") {
        return value === null ? current === null || current === undefined : current === value;
      }
      if (op === "gt") return typeof current === "string" && current > String(value);
      return typeof current === "string" && current < String(value);
    });

  function from(table: string) {
    if (table !== "webauthn_challenges") {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      insert(payload: Record<string, unknown>) {
        return {
          select() {
            return {
              single: async () => {
                state.seq += 1;
                const id = `00000000-0000-4000-8000-${String(state.seq).padStart(12, "0")}`;
                rows().push({
                  id,
                  consumed_at: null,
                  created_at: new Date().toISOString(),
                  ...payload,
                } as ChallengeRow);
                return { data: { id }, error: null };
              },
            };
          },
        };
      },
      delete() {
        const filters: Filter[] = [];
        const query = {
          lt(col: string, value: unknown) {
            filters.push({ col, op: "lt", value });
            return query;
          },
          then(resolve: (value: unknown) => unknown) {
            state.rows = rows().filter((row) => !matches(row, filters));
            resolve({ error: null });
          },
        };
        return query;
      },
      update(patch: Record<string, unknown>) {
        const filters: Filter[] = [];
        const query = {
          eq(col: string, value: unknown) {
            filters.push({ col, op: "eq", value });
            return query;
          },
          is(col: string, value: unknown) {
            filters.push({ col, op: "is", value });
            return query;
          },
          gt(col: string, value: unknown) {
            filters.push({ col, op: "gt", value });
            return query;
          },
          select() {
            return {
              single: async () => {
                const row = rows().find((candidate) =>
                  matches(candidate, filters),
                );
                if (!row) {
                  return { data: null, error: { code: "PGRST116" } };
                }
                Object.assign(row, patch);
                return { data: { challenge: row.challenge }, error: null };
              },
            };
          },
        };
        return query;
      },
    };
  }

  return { getSupabaseAdmin: () => ({ from }) };
});

import {
  consumeWebAuthnChallenge,
  createWebAuthnChallenge,
  WEBAUTHN_CHALLENGE_TTL_MS,
} from "./webauthn-challenge";

beforeEach(() => {
  state.rows = [];
  state.seq = 0;
});

function storedRow(): ChallengeRow {
  return state.rows[0] as ChallengeRow;
}

describe("webauthn challenges", () => {
  it("expire in five minutes", async () => {
    const before = Date.now();
    const { expiresAt } = await createWebAuthnChallenge({
      kind: "registration",
      challenge: "challenge-value",
    });
    const ttl = expiresAt - before;
    expect(ttl).toBeGreaterThanOrEqual(WEBAUTHN_CHALLENGE_TTL_MS - 25);
    expect(ttl).toBeLessThanOrEqual(WEBAUTHN_CHALLENGE_TTL_MS + 25);
  });

  it("can be consumed exactly once", async () => {
    const { id } = await createWebAuthnChallenge({
      kind: "registration",
      challenge: "challenge-value",
    });

    expect(await consumeWebAuthnChallenge(id, "registration")).toBe(
      "challenge-value",
    );
    expect(storedRow()).toMatchObject({ consumed_at: expect.any(String) });
    expect(await consumeWebAuthnChallenge(id, "registration")).toBeNull();
  });

  it("does not consume a challenge of another kind", async () => {
    const { id } = await createWebAuthnChallenge({
      kind: "registration",
      challenge: "challenge-value",
    });

    expect(await consumeWebAuthnChallenge(id, "authentication")).toBeNull();
    expect(storedRow().consumed_at).toBeNull();
    expect(await consumeWebAuthnChallenge(id, "registration")).toBe(
      "challenge-value",
    );
  });

  it("rejects an expired challenge and leaves it unconsumed", async () => {
    const { id } = await createWebAuthnChallenge({
      kind: "authentication",
      challenge: "challenge-value",
    });
    storedRow().expires_at = new Date(Date.now() - 1_000).toISOString();

    expect(await consumeWebAuthnChallenge(id, "authentication")).toBeNull();
    expect(storedRow().consumed_at).toBeNull();
  });

  it("rejects an unknown id", async () => {
    expect(
      await consumeWebAuthnChallenge(
        "00000000-0000-4000-8000-000000000000",
        "registration",
      ),
    ).toBeNull();
  });
});
