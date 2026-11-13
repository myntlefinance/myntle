import {
  Account,
  JsonRpcProvider,
  KeyPair,
  actions,
  type KeyPairString,
} from "near-api-js";

/**
 * The chain side of NEAR super-account setup.
 *
 * A named NEAR account is not an Intents account by itself: `intents.near`
 * keeps its own account → public-key mapping. The wallet must call
 * `add_public_key` once before it can authenticate. This module reads that
 * state, checks a wallet key, and sends the small network-fee grant from the
 * setup hot wallet.
 *
 * Server-only. The hot-wallet private key never reaches the browser.
 */

export const INTENTS_CONTRACT = "intents.near";

const YOCTO = 10n ** 24n;
const DEFAULT_GRANT_YOCTO = "1500000000000000000000"; // 0.0015 NEAR
const DEFAULT_MIN_BALANCE_YOCTO = "1000000000000000000000"; // 0.001 NEAR
const DEFAULT_DAILY_GRANTS = 50;

function rpcUrl(): string {
  return (
    process.env.NEAR_RPC_PRIMARY ??
    process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY ??
    "https://free.rpc.fastnear.com"
  );
}

function positiveYocto(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  if (!/^\d+$/.test(candidate) || BigInt(candidate) <= 0n) return fallback;
  return candidate;
}

/** 0.0015 NEAR, in yoctoNEAR. */
export function nearSetupGrantYocto(): string {
  return positiveYocto(process.env.NEAR_SETUP_GRANT_YOCTO, DEFAULT_GRANT_YOCTO);
}

/** A balance at or above this can pay the registration fee without a grant. */
export function nearSetupMinBalanceYocto(): string {
  return positiveYocto(
    process.env.NEAR_SETUP_MIN_BALANCE_YOCTO,
    DEFAULT_MIN_BALANCE_YOCTO,
  );
}

export function nearSetupDailyGrants(): number {
  const raw = Number(process.env.NEAR_SETUP_DAILY_GRANTS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DAILY_GRANTS;
}

/** Human-readable NEAR amount for the dialog. Never rounds up. */
export function yoctoToNear(value: string): string {
  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    return value;
  }
  const whole = amount / YOCTO;
  const fraction = amount % YOCTO;
  if (fraction === 0n) return whole.toString();
  const digits = fraction
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return `${whole}.${digits}`;
}

/** The setup hot wallet is configured. The key is never returned. */
export function nearSetupConfigured(): boolean {
  return Boolean(
    process.env.NEAR_SETUP_FAUCET_ACCOUNT_ID?.trim() &&
      process.env.NEAR_SETUP_FAUCET_PRIVATE_KEY?.trim(),
  );
}

export function nearSetupFaucetAccount(): string | null {
  return process.env.NEAR_SETUP_FAUCET_ACCOUNT_ID?.trim() || null;
}

/** A 64-hex NEAR implicit account needs no registration. */
export function isNearImplicitAccount(accountId: string): boolean {
  return /^[0-9a-f]{64}$/i.test(accountId);
}

async function callRpc<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<{ result?: T; error?: unknown }> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "near-setup", method, params }),
  });
  if (!res.ok) throw new Error(`NEAR RPC returned ${res.status}.`);
  const body = (await res.json()) as { result?: T; error?: unknown };
  if (body.error) throw new Error("NEAR RPC rejected the request.");
  return body;
}

async function viewFunction<T>(
  method: string,
  args: Record<string, unknown>,
  finality: "optimistic" | "final" = "final",
): Promise<T> {
  const body = await callRpc<{ result?: number[] }>("query", {
    request_type: "call_function",
    finality,
    account_id: INTENTS_CONTRACT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  const bytes = body.result?.result;
  if (!Array.isArray(bytes)) throw new Error("The NEAR view returned no value.");
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
}

/** Whether the exact key is registered to the account on `intents.near`. */
export async function isIntentsKeyRegistered(
  accountId: string,
  publicKey: string,
): Promise<boolean> {
  return viewFunction<boolean>("has_public_key", {
    account_id: accountId,
    public_key: publicKey,
  });
}

/** The account's liquid NEAR balance in yoctoNEAR. */
export async function getNearBalance(accountId: string): Promise<bigint> {
  const body = await callRpc<{ amount?: string }>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
  const amount = body.result?.amount;
  if (typeof amount !== "string") throw new Error("The NEAR account was not found.");
  return BigInt(amount);
}

/**
 * Whether a key is a full-access key on the account.
 *
 * This is how a setup request proves a client-provided key belongs to the
 * signed-in account before it is used or funded.
 */
export async function isNearFullAccessKey(
  accountId: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const body = await callRpc<{ permission?: unknown }>("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    });
    return body.result?.permission === "FullAccess";
  } catch {
    return false;
  }
}

/**
 * Whether a transaction is final. Used to resume a grant whose HTTP request
 * ended before the row was marked final.
 */
export async function isNearTransactionFinal(
  txHash: string,
  senderAccountId: string,
): Promise<boolean> {
  try {
    const body = await callRpc<{ final_execution_status?: string }>("tx", {
      tx_hash: txHash,
      sender_account_id: senderAccountId,
      wait_until: "NONE",
    });
    return body.result?.final_execution_status === "FINAL";
  } catch {
    return false;
  }
}

/**
 * The setup hot wallet is present, its key is a full-access key, and it can
 * cover one grant plus the transfer fee. A misconfigured faucet must not
 * consume a user's one grant row.
 */
export async function nearSetupFaucetReady(
  amountYocto: string,
): Promise<boolean> {
  if (!nearSetupConfigured()) return false;
  const accountId = nearSetupFaucetAccount();
  const privateKey = process.env.NEAR_SETUP_FAUCET_PRIVATE_KEY?.trim();
  if (!accountId || !privateKey) return false;

  let publicKey: string;
  try {
    publicKey = KeyPair.fromString(
      privateKey as KeyPairString,
    ).getPublicKey().toString();
  } catch {
    return false;
  }

  try {
    if (!(await isNearFullAccessKey(accountId, publicKey))) return false;
    const balance = await getNearBalance(accountId);
    return balance >= BigInt(amountYocto) + 10n ** 21n; // + 0.001 NEAR fee
  } catch {
    return false;
  }
}

/**
 * Sends the one-time network fee from the setup hot wallet.
 *
 * Returns the transaction hash only after the transfer is final, so the
 * registration button is never enabled against an unfunded account.
 */
export async function sendNearSetupGrant(args: {
  receiverId: string;
  amountYocto: string;
}): Promise<{ hash: string; faucetAccountId: string }> {
  const faucetAccountId = nearSetupFaucetAccount();
  const privateKey = process.env.NEAR_SETUP_FAUCET_PRIVATE_KEY?.trim();
  if (!faucetAccountId || !privateKey) {
    throw new Error("NEAR setup is not configured.");
  }

  const provider = new JsonRpcProvider({ url: rpcUrl() });
  const faucet = new Account(
    faucetAccountId,
    provider,
    privateKey as KeyPairString,
  );
  const result = await faucet.signAndSendTransaction({
    receiverId: args.receiverId,
    actions: [actions.transfer(BigInt(args.amountYocto))],
    waitUntil: "FINAL",
  });
  const hash = (result as { transaction_outcome?: { id?: string } })
    .transaction_outcome?.id;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("NEAR setup did not return a transaction hash.");
  }
  return { hash, faucetAccountId };
}
