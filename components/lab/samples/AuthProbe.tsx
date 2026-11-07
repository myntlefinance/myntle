"use client";

import { useState } from "react";
import bs58 from "bs58";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { useWallet } from "@/lib/wallet/registry";

/**
 * Lab-only 1Click user-auth probe (EVM first).
 *
 * Builds the empty-intent proof the verifier expects, signs it with the
 * connected EVM wallet, and exchanges it for a User-Session token. Nothing
 * here touches product code; tokens stay in memory and are never stored.
 */

const ONE_CLICK = "https://1click.chaindefuser.com";
const NEAR_RPC = "https://rpc.mainnet.near.org";
const MAGIC = new Uint8Array([86, 40, 246, 198]);

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Live salt from the verifier. The docs quote a stale value; the contract is authoritative. */
async function fetchSalt(): Promise<{ hex: string; bytes: Uint8Array }> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "salt",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: "intents.near",
        method_name: "current_salt",
        args_base64: "e30=",
      },
    }),
  });
  const data = (await res.json()) as { result?: { result?: number[] } };
  const chars = (data.result?.result ?? []).map((b) => String.fromCharCode(b)).join("");
  const hex = JSON.parse(chars) as string;
  return { hex, bytes: hexToBytes(hex) };
}

function timestampedRandomBytes(now: Date): Uint8Array {
  const bytes = new Uint8Array(15);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(now.getTime()) * 1_000_000n, true);
  crypto.getRandomValues(bytes.subarray(8));
  return bytes;
}

function encodeNonce(salt: Uint8Array, deadline: Date, randomBytes: Uint8Array): string {
  const borsh = new Uint8Array(27);
  borsh.set(salt, 0);
  new DataView(borsh.buffer).setBigUint64(4, BigInt(deadline.getTime()) * 1_000_000n, true);
  borsh.set(randomBytes, 12);
  const out = new Uint8Array(5 + borsh.length);
  out.set(MAGIC, 0);
  out.set([0], 4);
  out.set(borsh, 5);
  let bin = "";
  for (let i = 0; i < out.length; i += 1) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

type Phase = "idle" | "signing" | "authenticating" | "authenticated" | "error";

export default function AuthProbe({ variant }: { variant?: string }) {
  void variant;
  const { account, connected, connect, signMessage } = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [payload, setPayload] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [hasRefresh, setHasRefresh] = useState(false);
  const [balances, setBalances] = useState("");
  const [quoteNote] = useState(
    "Quotes take the partner key server-side (verified 201 for basic/advanced). Never send it from the browser.",
  );

  const push = (line: string) => setLog((lines) => [...lines, line]);

  async function signAndAuthenticate() {
    setLog([]);
    setBalances("");
    if (!connected || !account || account.kind !== "evm") {
      setPhase("error");
      push("Connect an EVM wallet first.");
      return;
    }
    try {
      setPhase("signing");
      push("Fetching live salt from intents.near.");
      const salt = await fetchSalt();
      push(`Salt ${salt.hex}. Building payload.`);
      const deadline = new Date(Date.now() + 5 * 60_000);
      const nonce = encodeNonce(salt.bytes, deadline, timestampedRandomBytes(new Date()));
      const body = JSON.stringify({
        signer_id: account.address.toLowerCase(),
        verifying_contract: "intents.near",
        deadline: deadline.toISOString(),
        nonce,
        intents: [],
      });
      setPayload(body);
      push("Payload built. Waiting for wallet signature.");
      const raw = await signMessage(new TextEncoder().encode(body));
      const sig = Uint8Array.from(raw);
      const v = sig[sig.length - 1];
      if (v === 27 || v === 28) sig[sig.length - 1] = v - 27;
      const signature = `secp256k1:${bs58.encode(sig)}`;
      push(`Signed (${sig.length} bytes, v normalized). Exchanging for session.`);

      setPhase("authenticating");
      const res = await fetch(`${ONE_CLICK}/v0/auth/authenticate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedData: { standard: "erc191", payload: body, signature } }),
      });
      const data = (await res.json().catch(() => null)) as {
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: number;
        refreshExpiresIn?: number;
        message?: string;
      } | null;
      if (!res.ok || !data?.accessToken) {
        throw new Error(data?.message ?? `Authenticate failed (${res.status}).`);
      }
      // In-memory only for the probe. Production must hold the refresh
      // token server-side in an httpOnly session, never in the browser.
      setAccessToken(data.accessToken);
      setHasRefresh(!!data.refreshToken);
      setPhase("authenticated");
      push(
        `Authenticated. Access lives ~${data.expiresIn ?? "?"}s, refresh ~${data.refreshExpiresIn ?? "?"}s. Tokens in memory only.`,
      );
    } catch (cause) {
      setPhase("error");
      push(cause instanceof Error ? cause.message : "Signing failed.");
    }
  }

  async function loadBalances() {
    if (!accessToken) return;
    try {
      push("Loading private balances.");
      const res = await fetch(`${ONE_CLICK}/v0/account/balances`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => null);
      setBalances(JSON.stringify(data, null, 2).slice(0, 2000));
      push(res.ok ? "Balances returned." : `Balances failed (${res.status}).`);
    } catch (cause) {
      push(cause instanceof Error ? cause.message : "Balances failed.");
    }
  }

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad flex items-center justify-between gap-2" style={{ paddingBottom: 10 }}>
        <span className="text-sm font-medium text-ink">User auth probe</span>
        <StatusPill tone={phase === "authenticated" ? "green" : phase === "error" ? "red" : "orange"}>
          {phase}
        </StatusPill>
      </div>
      <div className="border-t border-line" aria-hidden="true" />
      <div className="primitive-card-pad flex flex-col gap-2" style={{ paddingTop: 10 }}>
        <p className="text-xs leading-relaxed text-ink-3">
          {connected
            ? `Connected ${account?.address?.slice(0, 10)}… — sign the empty intent to mint a session.`
            : "Connect an EVM wallet, then sign the empty intent."}
        </p>
        {!connected ? (
          <Button variant="accent" size="sm" onClick={() => void connect("evm").catch((e: Error) => push(e.message))}>
            Connect
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="accent" size="sm" onClick={() => void signAndAuthenticate()}>
              Sign In
            </Button>
            <Button variant="secondary" size="sm" disabled={!accessToken} onClick={() => void loadBalances()}>
              Balances
            </Button>
          </div>
        )}
        <p className="text-xs leading-relaxed text-ink-3">{quoteNote}</p>
        {payload ? (
          <pre className="max-h-32 overflow-auto rounded-md bg-ink/5 p-2 text-[10px] leading-relaxed text-ink-2">
            {payload}
          </pre>
        ) : null}
        {accessToken ? (
          <p className="text-xs text-ink-3">
            Session live{hasRefresh ? " + refresh held (memory only)" : ""}. Token: {accessToken.slice(0, 18)}…
          </p>
        ) : null}
        {balances ? (
          <pre className="max-h-32 overflow-auto rounded-md bg-ink/5 p-2 text-[10px] leading-relaxed text-ink-2">
            {balances}
          </pre>
        ) : null}
        {log.length > 0 ? (
          <div className="flex flex-col gap-1">
            {log.map((line, i) => (
              <p key={i} className="text-xs text-ink-3">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
