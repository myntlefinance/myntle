import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import nacl from "tweetnacl";
import {
  InvalidInput,
  NotFound,
  ProviderUnavailable,
} from "@/lib/ports";
import {
  deriveDomainMintKey,
  deriveNftRecordKey,
  deriveRecordV1Key,
  deriveRecordV2Key,
  deriveRecordsCentralState,
  deriveSnsDomainKey,
  isOffCurve,
  resolveSnsOnchain,
} from "./onchain";

// ---------------------------------------------------------------------------
// Derivation vectors. The `bonfida.sns` keys were recorded live 2026-11-09
// (hand-rolled PDA derivation cross-checked against chain state: the
// derived domain account exists under the name program with the `.sns`
// root as parent and the frozen `bonfida.sns` owner). Every program
// constant in `onchain.ts` is covered by these pins: a wrong constant
// resolves wrong silently, so a wrong constant fails here.
// ---------------------------------------------------------------------------

describe("sns on-chain derivation", () => {
  it("derives the recorded bonfida.sns account keys", () => {
    expect(deriveSnsDomainKey("bonfida.sns")).toBe(
      "Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb",
    );
    expect(deriveRecordV1Key("bonfida.sns")).toBe(
      "5WCZ6uhXPXJ7UrzBvXBnE9biZykq1ezJ6JhYe6CHgA7d",
    );
    expect(deriveRecordV2Key("bonfida.sns")).toBe(
      "ETARvCjLwjyM6Jux1ndxuXuYEYy56Nf5uvU3abL1WyW6",
    );
    expect(
      deriveNftRecordKey("Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb"),
    ).toBe("ET1ZtHQxL7oii4R4aMqvd2Rqf6cxwwbJZPHJNqSFLWZn");
    expect(
      deriveDomainMintKey("Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb"),
    ).toBe("4eH4KgXyMEmfJWqXukYNud3vqobGxfFAtDprWf2jLjQE");
  });

  it("derives the records central state deterministically", () => {
    expect(deriveRecordsCentralState()).toBe(
      "2pMnqHvei2N5oDcVGCRdZx48gqti199wr5CsyTTafsbo",
    );
  });

  it("treats input case-insensitively (lowercases before deriving)", () => {
    expect(deriveSnsDomainKey("Bonfida.SNS")).toBe(
      deriveSnsDomainKey("bonfida.sns"),
    );
    expect(deriveSnsDomainKey("  bonfida.sns  ")).toBe(
      deriveSnsDomainKey("bonfida.sns"),
    );
  });

  it("supports one subdomain level", () => {
    const sub = deriveSnsDomainKey("vault.bonfida.sns");
    expect(sub).not.toBe(deriveSnsDomainKey("bonfida.sns"));
    expect(deriveSnsDomainKey("vault.bonfida.sns")).toBe(sub);
    expect(deriveRecordV1Key("vault.bonfida.sns")).toBe(
      deriveRecordV1Key("vault.bonfida.sns"),
    );
  });

  it("rejects deep nesting the way the SDK does", () => {
    expect(() => deriveSnsDomainKey("a.b.c.sns")).toThrow(InvalidInput);
    expect(() => deriveRecordV1Key("a.b.c.sns")).toThrow(InvalidInput);
  });

  it("checks the curve the way PublicKey.isOnCurve does", () => {
    const secret = new Uint8Array(32).fill(7);
    const onCurve = ed25519.getPublicKey(secret);
    expect(isOffCurve(onCurve)).toBe(false);
    const domain = bs58.decode(deriveSnsDomainKey("bonfida.sns"));
    expect(isOffCurve(domain)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mocked-RPC resolution paths.
// ---------------------------------------------------------------------------

const ENDPOINT = "https://example.invalid/";
const PROGRAM = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";
const ROOT = "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx";

function kp(seedByte: number) {
  const seed = new Uint8Array(32).fill(seedByte);
  return {
    seed,
    pub: ed25519.getPublicKey(seed),
    secret64: nacl.sign.keyPair.fromSeed(seed).secretKey,
  };
}

const OWNER = kp(11);
const RECORD = kp(22);
const TOKEN_OWNER = kp(33);
const OTHER = kp(44);

function registryData(owner: Uint8Array, tail: Uint8Array = new Uint8Array(0)): string {
  const out = new Uint8Array(96 + tail.length);
  out.set(bs58.decode(ROOT), 0);
  out.set(owner, 32);
  out.set(tail, 96);
  return Buffer.from(out).toString("base64");
}

function recordHeader(parent: Uint8Array, owner: Uint8Array): Uint8Array {
  const out = new Uint8Array(96);
  out.set(parent, 0);
  out.set(owner, 32);
  return out;
}

function v1Message(pubkey: Uint8Array, v1Key: Uint8Array): Uint8Array {
  return new TextEncoder().encode(
    Buffer.from(Buffer.concat([pubkey, v1Key])).toString("hex"),
  );
}

function v1RecordData(
  domainKey: Uint8Array,
  owner: Uint8Array,
  pubkey: Uint8Array,
  v1Key: Uint8Array,
  signature: Uint8Array,
): string {
  const out = new Uint8Array(96 + 96);
  out.set(recordHeader(domainKey, owner), 0);
  out.set(pubkey, 96);
  out.set(signature, 96 + 32);
  return Buffer.from(out).toString("base64");
}

function v2RecordData(
  domainKey: Uint8Array,
  owner: Uint8Array,
  opts: {
    stalenessValidation?: number;
    roaValidation?: number;
    stalenessId?: Uint8Array;
    roaId?: Uint8Array;
    content?: Uint8Array;
  },
): string {
  const content = opts.content ?? RECORD.pub;
  const payload = Buffer.concat([
    Buffer.from(opts.stalenessId ?? owner),
    Buffer.from(opts.roaId ?? content),
    Buffer.from(content),
  ]);
  const header = new DataView(new ArrayBuffer(8));
  header.setUint16(0, opts.stalenessValidation ?? 1, true);
  header.setUint16(2, opts.roaValidation ?? 1, true);
  header.setUint32(4, payload.length, true);
  const out = new Uint8Array(96 + 8 + payload.length);
  out.set(recordHeader(domainKey, owner), 0);
  out.set(new Uint8Array(header.buffer), 96);
  out.set(payload, 96 + 8);
  return Buffer.from(out).toString("base64");
}

function nftRecordData(tag: number, domainKey: Uint8Array): string {
  const out = new Uint8Array(98);
  out[0] = tag;
  out.set(domainKey, 2);
  return Buffer.from(out).toString("base64");
}

function tokenAccountData(owner: Uint8Array, amount: bigint): string {
  const out = new Uint8Array(165);
  out.set(owner, 32);
  new DataView(out.buffer).setBigUint64(64, amount, true);
  return Buffer.from(out).toString("base64");
}

type AccountFixture = { owner: string; data: string } | null;

type RpcMockOptions = {
  accounts: Record<string, AccountFixture>;
  largest?: { address: string }[] | { code: number };
  hang?: boolean;
  calls?: string[];
};

function mockRpc(options: RpcMockOptions): typeof fetch {
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (options.hang) return new Promise<Response>(() => {});
    const body = JSON.parse(String(init?.body)) as
      | { id: number; method: string; params: unknown[] }
      | { id: number; method: string; params: unknown[] }[];
    const answer = (
      id: number,
      method: string,
      params: unknown[],
    ): Record<string, unknown> => {
      options.calls?.push(method);
      if (method === "getAccountInfo") {
        const key = params[0] as string;
        const fixture = options.accounts[key];
        if (fixture === undefined || fixture === null) {
          return { jsonrpc: "2.0", id, result: { value: null } };
        }
        return {
          jsonrpc: "2.0",
          id,
          result: {
            value: {
              data: [fixture.data, "base64"],
              owner: fixture.owner,
              executable: false,
              lamports: 1,
              rentEpoch: 0,
              space: 1,
            },
          },
        };
      }
      if (method === "getTokenLargestAccounts") {
        const largest = options.largest;
        if (
          largest !== undefined &&
          !Array.isArray(largest) &&
          typeof largest.code === "number"
        ) {
          return { jsonrpc: "2.0", id, error: { code: largest.code } };
        }
        const value = Array.isArray(largest) ? largest : [];
        return { jsonrpc: "2.0", id, result: { value } };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      };
    };
    if (Array.isArray(body)) {
      return new Response(
        JSON.stringify(
          body.map((call) => answer(call.id, call.method, call.params)),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(answer(body.id, body.method, body.params)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return impl;
}

/** Four-account fixture for one `*.sns` name (null = account missing). */
function accounts(
  name: string,
  parts: { nft?: string | null; v1?: string | null; v2?: string | null; registry?: string | null },
): Record<string, AccountFixture> {
  const domain = deriveSnsDomainKey(name);
  const out: Record<string, AccountFixture> = {};
  out[domain] = parts.registry === undefined ? null : parts.registry === null ? null : { owner: PROGRAM, data: parts.registry };
  const put = (key: string, data: string | null | undefined) => {
    out[key] = data === undefined || data === null ? null : { owner: PROGRAM, data };
  };
  put(deriveRecordV1Key(name), parts.v1);
  put(deriveRecordV2Key(name), parts.v2);
  put(deriveNftRecordKey(domain), parts.nft);
  return out;
}

describe("sns on-chain resolution paths", () => {
  const CASE_DOMAIN = deriveSnsDomainKey("case.sns");

  it("falls back to the domain owner with the recorded bonfida.sns bytes", async () => {
    // Recorded live 2026-11-09 (registry account
    // Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb, 105 bytes: 96-byte
    // header plus the trailing bytes the account carries on-chain).
    const recorded =
      "PVPCSzg2DtOBOiPfst/YIKtYIct5KaONLqqyUug4JZXd2T43CyhRYg4Vw8Pp55sKbLCn2Y+KDVYSu33vP3hIJQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY2x1ZTIuc29s";
    const hit = await resolveSnsOnchain("bonfida.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("bonfida.sns", {
          registry: recorded,
          nft: null,
          v1: null,
          v2: null,
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe("Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v");
  });

  it("treats an inactive tokenizer record like no record (bonfida.sns, tag 3 live)", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          nft: nftRecordData(3, domain),
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(OWNER.pub));
  });

  it("returns null-account as NotFound when the name is unregistered", async () => {
    const failure = await resolveSnsOnchain("unregistered-xyz.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({ accounts: accounts("unregistered-xyz.sns", {}) }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFound);
  });

  it("pays the V1 record address when its signature verifies", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const v1Key = bs58.decode(deriveRecordV1Key("case.sns"));
    const signature = nacl.sign.detached(v1Message(RECORD.pub, v1Key), OWNER.secret64);
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v1: v1RecordData(domain, OWNER.pub, RECORD.pub, v1Key, signature),
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(RECORD.pub));
  });

  it("falls through to the owner on an invalid V1 signature (never pays the record)", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const v1Key = bs58.decode(deriveRecordV1Key("case.sns"));
    const good = nacl.sign.detached(v1Message(RECORD.pub, v1Key), OWNER.secret64);
    const bad = new Uint8Array(good);
    bad[0] ^= 0xff;
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v1: v1RecordData(domain, OWNER.pub, RECORD.pub, v1Key, bad),
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(OWNER.pub));
  });

  it("falls through to the owner when the V1 record is truncated", async () => {
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v1: Buffer.from(new Uint8Array(100)).toString("base64"),
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(OWNER.pub));
  });

  it("pays the V2 content when staleness and RoA verify", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v2: v2RecordData(domain, OWNER.pub, {}),
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(RECORD.pub));
  });

  it("breaks a stale V2 record to a valid V1 record", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const v1Key = bs58.decode(deriveRecordV1Key("case.sns"));
    const signature = nacl.sign.detached(v1Message(RECORD.pub, v1Key), OWNER.secret64);
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v1: v1RecordData(domain, OWNER.pub, RECORD.pub, v1Key, signature),
          v2: v2RecordData(domain, OWNER.pub, { stalenessId: OTHER.pub }),
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(RECORD.pub));
  });

  it("breaks a stale V2 record to the owner when no V1 record exists", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v2: v2RecordData(domain, OWNER.pub, { stalenessId: OTHER.pub }),
        }),
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(OWNER.pub));
  });

  it("fails a V2 RoA mismatch instead of paying the record", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v2: v2RecordData(domain, OWNER.pub, { roaId: OTHER.pub }),
        }),
      }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails a V2 record with an unexpected validation scheme", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          v2: v2RecordData(domain, OWNER.pub, { stalenessValidation: 0 }),
        }),
      }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("pays the token holder for an active tokenized domain", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const tokenAccount = bs58.encode(TOKEN_OWNER.pub.slice(0, 32).fill(9));
    const hit = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: {
          ...accounts("case.sns", {
            registry: registryData(OWNER.pub),
            nft: nftRecordData(2, domain),
          }),
          [tokenAccount]: {
            owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            data: tokenAccountData(TOKEN_OWNER.pub, 1n),
          },
        },
        largest: [{ address: tokenAccount }],
      }),
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(bs58.encode(TOKEN_OWNER.pub));
  });

  it("fails an active tokenized domain with no token holder", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          nft: nftRecordData(2, domain),
        }),
        largest: [],
      }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails an active tokenized domain whose largest account holds nothing", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const tokenAccount = bs58.encode(OTHER.pub.slice(0, 32).fill(8));
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: {
          ...accounts("case.sns", {
            registry: registryData(OWNER.pub),
            nft: nftRecordData(2, domain),
          }),
          [tokenAccount]: {
            owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            data: tokenAccountData(TOKEN_OWNER.pub, 0n),
          },
        },
        largest: [{ address: tokenAccount }],
      }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("treats a missing domain mint (-32602) as no token holder", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: registryData(OWNER.pub),
          nft: nftRecordData(2, domain),
        }),
        largest: { code: -32602 },
      }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails an off-curve domain owner instead of paying a PDA", async () => {
    const domain = bs58.decode(CASE_DOMAIN);
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", { registry: registryData(domain) }),
      }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails a truncated registry account", async () => {
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({
        accounts: accounts("case.sns", {
          registry: Buffer.from(new Uint8Array(10)).toString("base64"),
        }),
      }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails the whole read when the transport throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("rpc down");
    }) as typeof fetch;
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails the whole read when the batch leaves the envelope", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails a hung RPC call at the per-call timeout", async () => {
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: mockRpc({ accounts: {}, hang: true }),
      timeoutMs: 20,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("fails a slow flow at the hard overall timeout", async () => {
    const slow = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: ENDPOINT,
      fetchImpl: slow,
      timeoutMs: 5_000,
      overallTimeoutMs: 20,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("rejects malformed input before any network call", async () => {
    for (const bad of ["", "   ", "case.sol", "case.eth", "no-suffix", ".sns"]) {
      let calls = 0;
      const fetchImpl = (async () => {
        calls += 1;
        throw new Error("must not be called");
      }) as typeof fetch;
      const failure = await resolveSnsOnchain(bad, {
        endpoint: ENDPOINT,
        fetchImpl,
        timeoutMs: 1_000,
      }).catch((error: unknown) => error);
      expect(failure, bad).toBeInstanceOf(InvalidInput);
      expect(calls, bad).toBe(0);
    }
  });

  it("rejects deep nesting before any network call", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("must not be called");
    }) as typeof fetch;
    const failure = await resolveSnsOnchain("a.b.c.sns", {
      endpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InvalidInput);
    expect(calls).toBe(0);
  });

  it("requires an endpoint", async () => {
    const failure = await resolveSnsOnchain("case.sns", {
      endpoint: "",
      fetchImpl: mockRpc({ accounts: {} }),
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });
});
