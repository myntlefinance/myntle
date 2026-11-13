import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import nacl from "tweetnacl";
import {
  InvalidInput,
  NotFound,
  ProviderUnavailable,
} from "@/lib/ports";
import { createNameResolver } from "@/lib/names/resolve";
import {
  deriveNftRecordKey,
  deriveRecordV1Key,
  deriveRecordV2Key,
  deriveSnsDomainKey,
  resolveSnsOnchain,
} from "./onchain";
import {
  resolveSnsAddress,
  resolveSnsViaProxy,
} from "./sns";

/**
 * Differential corpus: on-chain resolution ≡ proxy resolution.
 *
 * This file lives permanently as the regression net for the on-chain SNS
 * reader. Every case runs BOTH adapters — the on-chain reader against a
 * mocked RPC endpoint and the proxy reader against a mocked proxy fetch —
 * and asserts they agree. The comparison direction is fixed: the proxy
 * wins disagreements. A disagreeing case fails this file (and therefore
 * the step); it may only land as a recorded proxy-wins exclusion, never
 * as shipped divergent behavior. There are currently no exclusions: the
 * corpus is fully green because the on-chain reader mirrors the SDK's
 * SNS-IP 5 flow exactly, and any flow the SDK throws on becomes an
 * on-chain failure that falls back to the proxy — collapsing to the
 * proxy's own answer at runtime.
 *
 * Provenance per case:
 * - "plain .sns" uses bytes RECORDED live 2026-11-09 (the `bonfida.sns`
 *   registry account; the frozen address `Fw1ET…b1v` is the owner field
 *   of that account, and the proxy envelope for it is recorded in the
 *   step-01 contract).
 * - Record/tokenized cases are CONSTRUCTED vectors (fixed ed25519 seeds,
 *   V1 signatures produced with tweetnacl and verified with
 *   @noble/curves): no live `.sns` name with a SOL record or an active
 *   tokenizer record was found across ~40 probed names, so these paths
 *   are pinned by construction instead. The proxy halves of those cases
 *   mock what the same flow answers.
 * - "unregistered" and "malformed" pin the frozen taxonomy at the name
 *   layer, where both sides reject before any network call.
 */

const ENDPOINT = "https://example.invalid/";
const PROGRAM = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";
const ROOT = "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx";
const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
const RECORDED_BONFIDA_REGISTRY =
  "PVPCSzg2DtOBOiPfst/YIKtYIct5KaONLqqyUug4JZXd2T43CyhRYg4Vw8Pp55sKbLCn2Y+KDVYSu33vP3hIJQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY2x1ZTIuc29s";

function kp(seedByte: number) {
  const seed = new Uint8Array(32).fill(seedByte);
  return {
    pub: ed25519.getPublicKey(seed),
    secret64: nacl.sign.keyPair.fromSeed(seed).secretKey,
  };
}

const OWNER = kp(11);
const RECORD = kp(22);
const TOKEN_OWNER = kp(33);
const OTHER = kp(44);

function registryData(owner: Uint8Array): string {
  const out = new Uint8Array(96);
  out.set(bs58.decode(ROOT), 0);
  out.set(owner, 32);
  return Buffer.from(out).toString("base64");
}

function v1RecordData(
  domainKey: Uint8Array,
  owner: Uint8Array,
  pubkey: Uint8Array,
  v1Key: Uint8Array,
  signature: Uint8Array,
): string {
  const out = new Uint8Array(192);
  out.set(domainKey, 0);
  out.set(owner, 32);
  out.set(pubkey, 96);
  out.set(signature, 128);
  return Buffer.from(out).toString("base64");
}

function v1Signature(pubkey: Uint8Array, v1Key: Uint8Array, signer: { secret64: Uint8Array }): Uint8Array {
  const message = new TextEncoder().encode(
    Buffer.from(Buffer.concat([pubkey, v1Key])).toString("hex"),
  );
  return nacl.sign.detached(message, signer.secret64);
}

function v2RecordData(
  domainKey: Uint8Array,
  owner: Uint8Array,
  opts: {
    stalenessValidation?: number;
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
  header.setUint16(2, 1, true);
  header.setUint32(4, payload.length, true);
  const out = new Uint8Array(96 + 8 + payload.length);
  out.set(domainKey, 0);
  out.set(owner, 32);
  out.set(new Uint8Array(header.buffer), 96);
  out.set(payload, 104);
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

function fourAccounts(
  name: string,
  parts: { nft?: string | null; v1?: string | null; v2?: string | null; registry?: string | null },
): Record<string, AccountFixture> {
  const domain = deriveSnsDomainKey(name);
  const out: Record<string, AccountFixture> = { [domain]: null };
  if (parts.registry !== undefined && parts.registry !== null) {
    out[domain] = { owner: PROGRAM, data: parts.registry };
  }
  const put = (key: string, data: string | null | undefined) => {
    out[key] = data === undefined || data === null ? null : { owner: PROGRAM, data };
  };
  put(deriveRecordV1Key(name), parts.v1);
  put(deriveRecordV2Key(name), parts.v2);
  put(deriveNftRecordKey(domain), parts.nft);
  return out;
}

function rpcBody(
  accounts: Record<string, AccountFixture>,
  largest: { address: string }[] | { code: number } | undefined,
  tokenAccounts: Record<string, string>,
  method: string,
  params: unknown[],
): Record<string, unknown> {
  if (method === "getAccountInfo") {
    const fixture = accounts[params[0] as string] ?? tokenAccounts[params[0] as string];
    if (fixture === undefined || fixture === null) return { result: { value: null } };
    const data = typeof fixture === "string" ? fixture : fixture.data;
    const owner = typeof fixture === "string" ? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" : fixture.owner;
    return { result: { value: { data: [data, "base64"], owner } } };
  }
  if (method === "getTokenLargestAccounts") {
    if (largest !== undefined && !Array.isArray(largest)) {
      return { error: { code: largest.code } };
    }
    return { result: { value: Array.isArray(largest) ? largest : [] } };
  }
  return { error: { code: -32601 } };
}

function proxyJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * One fetch double serving both sides: RPC-shaped URLs hit the mocked
 * endpoint, everything else hits the mocked proxy. `proxyFor` selects the
 * proxy fixture by resolved name.
 */
function dualFetch(options: {
  accounts: Record<string, AccountFixture>;
  largest?: { address: string }[] | { code: number };
  tokenAccounts?: Record<string, string>;
  proxyFor: (name: string) => Response | Promise<Response>;
  urls?: string[];
  hangRpc?: boolean;
  failRpc?: boolean;
}): typeof fetch {
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    options.urls?.push(url);
    if (url.startsWith(ENDPOINT)) {
      if (options.hangRpc) return new Promise<Response>(() => {});
      if (options.failRpc) throw new Error("rpc down");
      const body = JSON.parse(String(init?.body)) as
        | { id: number; method: string; params: unknown[] }
        | { id: number; method: string; params: unknown[] }[];
      if (Array.isArray(body)) {
        return new Response(
          JSON.stringify(
            body.map((call) => ({
              jsonrpc: "2.0",
              id: call.id,
              ...rpcBody(options.accounts, options.largest, options.tokenAccounts ?? {}, call.method, call.params),
            })),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          ...rpcBody(options.accounts, options.largest, options.tokenAccounts ?? {}, body.method, body.params),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    const match = /\/resolve\/([^?]+)/.exec(url);
    return options.proxyFor(decodeURIComponent(match?.[1] ?? ""));
  }) as typeof fetch;
  return impl;
}

type Outcome =
  | { ok: true; address: string }
  | { ok: false; kind: "notfound" | "unavailable" | "invalid" };

async function onchainOutcome(name: string, fetchImpl: typeof fetch): Promise<Outcome> {
  try {
    const hit = await resolveSnsOnchain(name, {
      endpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    });
    return { ok: true, address: hit.address };
  } catch (error) {
    if (error instanceof NotFound) return { ok: false, kind: "notfound" };
    if (error instanceof InvalidInput) return { ok: false, kind: "invalid" };
    if (error instanceof ProviderUnavailable) return { ok: false, kind: "unavailable" };
    throw error;
  }
}

async function proxyOutcome(name: string, fetchImpl: typeof fetch): Promise<Outcome> {
  try {
    const hit = await resolveSnsViaProxy(name, {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    });
    return { ok: true, address: hit.address };
  } catch (error) {
    if (error instanceof NotFound) return { ok: false, kind: "notfound" };
    if (error instanceof InvalidInput) return { ok: false, kind: "invalid" };
    if (error instanceof ProviderUnavailable) return { ok: false, kind: "unavailable" };
    throw error;
  }
}

/**
 * One differential case: both sides run, and the on-chain outcome must
 * equal the proxy outcome. The proxy wins by construction of this
 * assertion — a divergence fails the suite.
 */
async function expectAgreement(
  label: string,
  name: string,
  options: {
    accounts: Record<string, AccountFixture>;
    largest?: { address: string }[] | { code: number };
    tokenAccounts?: Record<string, string>;
    proxyFor: (name: string) => Response | Promise<Response>;
  },
): Promise<void> {
  const fetchImpl = dualFetch(options);
  const [onchain, proxy] = await Promise.all([
    onchainOutcome(name, fetchImpl),
    proxyOutcome(name, fetchImpl),
  ]);
  expect(proxy, `${label}: proxy side must stay in-taxonomy`).toBeDefined();
  expect(onchain, `${label}: on-chain ≡ proxy (proxy wins)`).toEqual(proxy);
}

describe("sns differential corpus (on-chain ≡ proxy, proxy wins)", () => {
  it("plain .sns agrees on the recorded bonfida.sns vector", async () => {
    await expectAgreement("plain .sns", "bonfida.sns", {
      accounts: fourAccounts("bonfida.sns", {
        registry: RECORDED_BONFIDA_REGISTRY,
      }),
      proxyFor: (name) =>
        name === "bonfida.sns"
          ? proxyJson(200, { s: "ok", result: BONFIDA })
          : proxyJson(404, { s: "error", error: "Domain not found" }),
    });
  });

  it(".sns with a valid V1 SOL record agrees", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    const v1Key = bs58.decode(deriveRecordV1Key("case.sns"));
    const record = bs58.encode(RECORD.pub);
    await expectAgreement("v1 valid", "case.sns", {
      accounts: fourAccounts("case.sns", {
        registry: registryData(OWNER.pub),
        v1: v1RecordData(domain, OWNER.pub, RECORD.pub, v1Key, v1Signature(RECORD.pub, v1Key, OWNER)),
      }),
      proxyFor: () => proxyJson(200, { s: "ok", result: record }),
    });
  });

  it(".sns with an invalid V1 signature agrees on the owner fallback", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    const v1Key = bs58.decode(deriveRecordV1Key("case.sns"));
    const good = v1Signature(RECORD.pub, v1Key, OWNER);
    const bad = new Uint8Array(good);
    bad[63] ^= 0x01;
    const owner = bs58.encode(OWNER.pub);
    await expectAgreement("v1 invalid", "case.sns", {
      accounts: fourAccounts("case.sns", {
        registry: registryData(OWNER.pub),
        v1: v1RecordData(domain, OWNER.pub, RECORD.pub, v1Key, bad),
      }),
      // A correct proxy falls through exactly the same way.
      proxyFor: () => proxyJson(200, { s: "ok", result: owner }),
    });
  });

  it(".sns with a valid V2 SOL record agrees", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    const record = bs58.encode(RECORD.pub);
    await expectAgreement("v2 valid", "case.sns", {
      accounts: fourAccounts("case.sns", {
        registry: registryData(OWNER.pub),
        v2: v2RecordData(domain, OWNER.pub, {}),
      }),
      proxyFor: () => proxyJson(200, { s: "ok", result: record }),
    });
  });

  it(".sns with a stale V2 record agrees on the V1 fallback", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    const v1Key = bs58.decode(deriveRecordV1Key("case.sns"));
    const record = bs58.encode(RECORD.pub);
    await expectAgreement("v2 stale", "case.sns", {
      accounts: fourAccounts("case.sns", {
        registry: registryData(OWNER.pub),
        v1: v1RecordData(domain, OWNER.pub, RECORD.pub, v1Key, v1Signature(RECORD.pub, v1Key, OWNER)),
        v2: v2RecordData(domain, OWNER.pub, { stalenessId: OTHER.pub }),
      }),
      proxyFor: () => proxyJson(200, { s: "ok", result: record }),
    });
  });

  it(".sns with a V2 RoA mismatch agrees on failure", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    await expectAgreement("v2 roa mismatch", "case.sns", {
      accounts: fourAccounts("case.sns", {
        registry: registryData(OWNER.pub),
        v2: v2RecordData(domain, OWNER.pub, { roaId: OTHER.pub }),
      }),
      // The proxy runs the same check and rejects the read.
      proxyFor: () => proxyJson(500, { s: "error", error: "Internal error" }),
    });
  });

  it("tokenized .sns agrees on the token holder", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    const tokenAccount = bs58.encode(new Uint8Array(32).fill(9));
    const holder = bs58.encode(TOKEN_OWNER.pub);
    await expectAgreement("tokenized", "case.sns", {
      accounts: fourAccounts("case.sns", {
        registry: registryData(OWNER.pub),
        nft: nftRecordData(2, domain),
      }),
      largest: [{ address: tokenAccount }],
      tokenAccounts: { [tokenAccount]: tokenAccountData(TOKEN_OWNER.pub, 1n) },
      proxyFor: () => proxyJson(200, { s: "ok", result: holder }),
    });
  });

  it("tokenized .sns with no holder agrees on failure", async () => {
    const domain = bs58.decode(deriveSnsDomainKey("case.sns"));
    await expectAgreement("tokenized holderless", "case.sns", {
      accounts: fourAccounts("case.sns", {
        registry: registryData(OWNER.pub),
        nft: nftRecordData(2, domain),
      }),
      largest: [],
      proxyFor: () => proxyJson(500, { s: "error", error: "Internal error" }),
    });
  });

  it("unregistered .sns agrees on null", async () => {
    await expectAgreement("unregistered", "unregistered-xyz.sns", {
      accounts: fourAccounts("unregistered-xyz.sns", {}),
      proxyFor: () => proxyJson(404, { s: "error", error: "Domain not found" }),
    });
  });

  it("malformed input agrees on invalid_input without network", async () => {
    const cases: [string, string][] = [
      ["!!!", "bad_suffix"],
      ["bad!!name.sns", "bad_name"],
    ];
    for (const [bad, reason] of cases) {
      const calls: string[] = [];
      const fetchImpl = dualFetch({
        accounts: {},
        proxyFor: () => proxyJson(500, { s: "error" }),
        urls: calls,
      });
      const [onchain, proxy] = await Promise.all([
        (async () => {
          const resolver = createNameResolver({
            snsResolve: (name) =>
              resolveSnsOnchain(name, {
                endpoint: ENDPOINT,
                fetchImpl,
                timeoutMs: 200,
              }),
          });
          return resolver.resolveName("solana", bad).then(
            () => "resolved" as const,
            (error: unknown) => error,
          );
        })(),
        (async () => {
          const resolver = createNameResolver({
            snsResolve: (name) =>
              resolveSnsViaProxy(name, {
                rpcEndpoint: ENDPOINT,
                fetchImpl,
                timeoutMs: 200,
              }),
          });
          return resolver.resolveName("solana", bad).then(
            () => "resolved" as const,
            (error: unknown) => error,
          );
        })(),
      ]);
      expect(onchain).toEqual(proxy);
      expect(onchain).toMatchObject({ kind: "invalid_input", reason });
      expect(calls).toHaveLength(0);
    }
  });

  it(".sol stays unavailable on both sides (SRS transition)", async () => {
    const calls: string[] = [];
    const fetchImpl = dualFetch({
      accounts: {},
      proxyFor: () => proxyJson(400, { s: "error", error: "Unsupported TLD" }),
      urls: calls,
    });
    for (const snsResolve of [
      (name: string) =>
        resolveSnsOnchain(name, { endpoint: ENDPOINT, fetchImpl, timeoutMs: 200 }),
      (name: string) =>
        resolveSnsViaProxy(name, { rpcEndpoint: ENDPOINT, fetchImpl, timeoutMs: 200 }),
    ]) {
      const resolver = createNameResolver({ snsResolve });
      const failure = await resolver
        .resolveName("solana", "whatever.sol")
        .then(
          () => "resolved" as const,
          (error: unknown) => error,
        );
      expect(failure).toMatchObject({ kind: "unavailable", reason: "sns_sol_transition" });
    }
    expect(calls).toHaveLength(0);
  });

  it("the net bites: a divergent proxy answer is a failure", async () => {
    const fetchImpl = dualFetch({
      accounts: fourAccounts("case.sns", { registry: registryData(OWNER.pub) }),
      proxyFor: () => proxyJson(200, { s: "ok", result: bs58.encode(OTHER.pub) }),
    });
    const [onchain, proxy] = await Promise.all([
      onchainOutcome("case.sns", fetchImpl),
      proxyOutcome("case.sns", fetchImpl),
    ]);
    // If this ever equals, the corpus cannot see disagreement — fix the
    // fixtures, and record the case as a proxy-wins exclusion.
    expect(onchain).not.toEqual(proxy);
  });
});

describe("sns failover (on-chain primary, proxy fallback)", () => {
  const PROXY_HIT = BONFIDA;

  it("falls back to the proxy when the RPC is down", async () => {
    const urls: string[] = [];
    const fetchImpl = dualFetch({
      accounts: {},
      failRpc: true,
      urls,
      proxyFor: () => proxyJson(200, { s: "ok", result: PROXY_HIT }),
    });
    const hit = await resolveSnsAddress("bonfida.sns", {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    });
    expect(hit.address).toBe(PROXY_HIT);
    expect(urls.some((url) => url.startsWith(ENDPOINT))).toBe(true);
    expect(urls.some((url) => url.includes("/resolve/bonfida.sns"))).toBe(true);
  });

  it("falls back to the proxy when the RPC hangs", async () => {
    const fetchImpl = dualFetch({
      accounts: {},
      hangRpc: true,
      proxyFor: () => proxyJson(200, { s: "ok", result: PROXY_HIT }),
    });
    const hit = await resolveSnsAddress("bonfida.sns", {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 30,
    });
    expect(hit.address).toBe(PROXY_HIT);
  });

  it("keeps the proxy taxonomy after fallback (404 → NotFound)", async () => {
    const fetchImpl = dualFetch({
      accounts: {},
      failRpc: true,
      proxyFor: () => proxyJson(404, { s: "error", error: "Domain not found" }),
    });
    const failure = await resolveSnsAddress("unregistered-xyz.sns", {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFound);
  });

  it("keeps the proxy taxonomy after fallback (500 → ProviderUnavailable)", async () => {
    const fetchImpl = dualFetch({
      accounts: {},
      failRpc: true,
      proxyFor: () => proxyJson(500, { s: "error", error: "Internal error" }),
    });
    const failure = await resolveSnsAddress("bonfida.sns", {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("propagates on-chain NotFound without consulting the proxy", async () => {
    const urls: string[] = [];
    const fetchImpl = dualFetch({
      accounts: fourAccounts("unregistered-xyz.sns", {}),
      urls,
      proxyFor: () => proxyJson(200, { s: "ok", result: PROXY_HIT }),
    });
    const failure = await resolveSnsAddress("unregistered-xyz.sns", {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFound);
    expect(urls.some((url) => url.includes("/resolve/"))).toBe(false);
  });

  it("propagates InvalidInput without consulting the proxy", async () => {
    const urls: string[] = [];
    const fetchImpl = dualFetch({
      accounts: {},
      urls,
      proxyFor: () => proxyJson(200, { s: "ok", result: PROXY_HIT }),
    });
    const failure = await resolveSnsAddress("!!!", {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 1_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InvalidInput);
    expect(urls.some((url) => url.includes("/resolve/"))).toBe(false);
  });
});