"use client";

import type { DataStorage, NearWalletBase } from "@hot-labs/near-connect";
import { sendNearDepositWithWallet } from "../near-transfer";
import { trackFundingConnection } from "./release";
import {
  gasShortfall,
  tokenShortfall,
  type FundingCheck,
  type FundingConnection,
  type FundingDeposit,
  type FundingSendInput,
  type FundingSendResult,
} from "./types";

const NEAR_RPC =
  process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY ?? "https://free.rpc.fastnear.com";
const NEAR_DECIMALS = 24;
/** A small native buffer for gas and storage on a token transfer. */
const NEAR_FEE_BUFFER = 10n ** 22n; // 0.01 NEAR

type NearRpcResult = {
  result?: unknown;
  error?: unknown;
};

async function nearView(params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "funding-balance",
      method: "query",
      params,
    }),
  });
  if (!res.ok) throw new Error("The NEAR balance could not be read.");
  const body = (await res.json()) as NearRpcResult;
  if (body.error) throw new Error("The NEAR balance could not be read.");
  return body.result;
}

async function readNearBalances(
  address: string,
  tokenContract?: string | null,
): Promise<{ native: bigint; token: bigint | null }> {
  const account = (await nearView({
    request_type: "view_account",
    finality: "final",
    account_id: address,
  })) as { amount?: string } | null;
  const native = BigInt(account?.amount ?? "0");
  if (!tokenContract) return { native, token: null };
  const args = btoa(JSON.stringify({ account_id: address }));
  const result = (await nearView({
    request_type: "call_function",
    finality: "final",
    account_id: tokenContract,
    method_name: "ft_balance_of",
    args_base64: args,
  })) as { result?: number[] } | null;
  const text = new TextDecoder().decode(
    new Uint8Array(result?.result ?? []),
  );
  const parsed = text ? (JSON.parse(text) as unknown) : "0";
  return {
    native,
    token: BigInt(typeof parsed === "string" ? parsed : "0"),
  };
}

export async function checkNearDeposit(
  deposit: FundingDeposit,
  address: string,
): Promise<FundingCheck> {
  const amount = BigInt(deposit.amountRaw);
  const { native, token } = await readNearBalances(
    address,
    deposit.tokenContract,
  );
  const tokenBalance = deposit.tokenContract ? token ?? 0n : null;
  const enoughToken = deposit.tokenContract
    ? (tokenBalance ?? 0n) >= amount
    : native >= amount;
  const enoughGas = deposit.tokenContract
    ? native > NEAR_FEE_BUFFER
    : native >= amount + NEAR_FEE_BUFFER;

  let shortfall: string | undefined;
  if (!enoughToken) {
    shortfall = deposit.tokenContract
      ? tokenShortfall(
          amount,
          tokenBalance ?? 0n,
          deposit.decimals,
          deposit.symbol,
        )
      : tokenShortfall(amount, native, NEAR_DECIMALS, "NEAR");
  } else if (!enoughGas) {
    const gasNeed = deposit.tokenContract ? NEAR_FEE_BUFFER : amount + NEAR_FEE_BUFFER;
    shortfall = gasShortfall(
      gasNeed,
      native,
      NEAR_DECIMALS,
      "NEAR",
      !deposit.tokenContract,
    );
  }

  return {
    tokenBalance,
    nativeBalance: native,
    enoughToken,
    enoughGas,
    shortfall,
  };
}

export function createNearFundingConnection(input: {
  address: string;
  wallet?: NearWalletBase;
  walletName?: string;
  walletIcon?: string;
  send?: (input: FundingSendInput) => Promise<FundingSendResult>;
}): FundingConnection {
  return {
    kind: "near",
    address: input.address,
    walletName: input.walletName,
    walletIcon: input.walletIcon,
    check: (deposit) => checkNearDeposit(deposit, input.address),
    send:
      input.send ??
      (async (deposit) => {
        if (!input.wallet) throw new Error("No NEAR wallet is connected");
        const txHash = await sendNearDepositWithWallet(input.wallet, {
          depositAddress: deposit.address,
          amount: deposit.amountRaw,
          tokenContract: deposit.tokenContract,
        });
        return { txHash, senderAccount: input.address };
      }),
  };
}

/** Reuse the app's connected NEAR wallet; the card supplies the send path. */
export function createConnectedNearFunding(input: {
  address: string;
  send: (input: FundingSendInput) => Promise<FundingSendResult>;
}): FundingConnection {
  return {
    kind: "near",
    address: input.address,
    connected: true,
    check: (deposit) => checkNearDeposit(deposit, input.address),
    send: input.send,
  };
}

/**
 * Storage for the funding connector.
 *
 * The app's near-connect provider stores its selected wallet in localStorage
 * under a shared key. A funding connection must not read or replace that
 * choice, so its connector gets a private in-memory store instead.
 */
class MemoryStorage implements DataStorage {
  private values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

let fundingConnector: import("@hot-labs/near-connect").NearConnector | null =
  null;

/**
 * Connect a NEAR funding wallet through a separate near-connect instance.
 *
 * The connector opens the normal NEAR wallet selector, but its storage is
 * private and its events are its own. It never calls the app's sign-in or
 * passkey path, and it never writes the wallet the application is using.
 */
export async function connectNearFunding(): Promise<FundingConnection> {
  const { NearConnector } = await import("@hot-labs/near-connect");
  fundingConnector ??= new NearConnector({
    network: "mainnet",
    autoConnect: false,
    storage: new MemoryStorage(),
    footerBranding: null,
    providers: {
      mainnet: ["https://free.rpc.fastnear.com"],
      testnet: ["https://test.rpc.fastnear.com"],
    },
  });
  const wallet = await fundingConnector.connect();
  const accounts = await wallet.getAccounts();
  const accountId = accounts[0]?.accountId;
  if (!accountId) throw new Error("NEAR wallet did not share an account");
  // This connector is a second near-connect instance, so the app's sign-out
  // never touches it. Release its wallet with the rest of the funding grants.
  const connector = fundingConnector;
  trackFundingConnection(async () => {
    if (fundingConnector === connector) fundingConnector = null;
    await connector.disconnect(wallet);
  });
  return createNearFundingConnection({
    address: accountId,
    wallet,
    walletName: wallet.manifest?.name,
    walletIcon: wallet.manifest?.icon,
  });
}
