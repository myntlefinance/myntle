"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
} from "viem";
import { evmChainForId, evmChainForSlug, type EvmChainRef } from "../evm-chains";
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

type RequestProvider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
};

export type EvmProvider = EIP1193Provider & RequestProvider;

/** Resolve the deposit's chain, refusing an unknown chain rather than guessing. */
export function evmFundingChain(deposit: FundingDeposit): EvmChainRef | null {
  const bySlug = evmChainForSlug(deposit.chainSlug);
  if (bySlug) {
    // A slug and an id that disagree are malformed metadata. Refusing is
    // safer than sending on whichever one happens to win.
    if (deposit.chainId && bySlug.id !== deposit.chainId) return null;
    return bySlug;
  }
  return deposit.chainId ? evmChainForId(deposit.chainId) : null;
}

function chainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

async function readChainId(provider: RequestProvider): Promise<number | null> {
  try {
    const value = (await provider.request({ method: "eth_chainId" })) as string;
    const parsed = Number.parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isUnknownChainError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const code = (cause as { code?: unknown }).code;
  return code === 4902 || code === -32603;
}

async function requestAccounts(
  provider: RequestProvider,
  mode: "request" | "existing",
  expected?: string,
): Promise<string> {
  const accounts = (await provider.request({
    method: mode === "request" ? "eth_requestAccounts" : "eth_accounts",
  })) as unknown;
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("This wallet did not share an account");
  }
  if (expected) {
    const match = accounts.find(
      (account): account is string =>
        typeof account === "string" &&
        account.toLowerCase() === expected.toLowerCase(),
    );
    if (!match) throw new Error("This wallet is not connected");
    return match;
  }
  return accounts[0];
}

async function ensureChain(
  provider: RequestProvider,
  chain: Chain,
): Promise<void> {
  const current = await readChainId(provider);
  if (current === chain.id) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex(chain.id) }],
    });
  } catch (cause) {
    if (!isUnknownChainError(cause)) throw new Error("chain-switch-rejected");
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex(chain.id),
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: chain.blockExplorers
            ? [chain.blockExplorers.default.url]
            : undefined,
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex(chain.id) }],
    });
  }
  if ((await readChainId(provider)) !== chain.id) {
    throw new Error("chain-switch-rejected");
  }
}

/**
 * Read the exact token and gas position for an EVM deposit.
 *
 * Gas is estimated first and falls back to a conservative positive native
 * balance when the wallet's RPC cannot estimate. Balance reads are advisory:
 * the dialog shows the shortfall and always keeps the QR path.
 */
export async function checkEvmDeposit(input: {
  client: PublicClient;
  address: Address;
  chain: Chain;
  deposit: FundingDeposit;
}): Promise<FundingCheck> {
  const { client, address, chain, deposit } = input;
  const amount = BigInt(deposit.amountRaw);
  const nativeBalance = await client.getBalance({ address });
  const nativeSymbol = chain.nativeCurrency.symbol;
  const nativeDecimals = chain.nativeCurrency.decimals;

  let tokenBalance: bigint | null = null;
  let enoughToken = true;
  if (deposit.tokenContract) {
    tokenBalance = await client.readContract({
      address: deposit.tokenContract as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    enoughToken = tokenBalance >= amount;
  } else {
    enoughToken = nativeBalance >= amount;
  }

  let gasCost = 0n;
  try {
    const gas = deposit.tokenContract
      ? await client.estimateContractGas({
          account: address,
          address: deposit.tokenContract as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [deposit.address as Address, amount],
        })
      : await client.estimateGas({
          account: address,
          to: deposit.address as Address,
          value: amount,
        });
    const gasPrice = await client.getGasPrice();
    gasCost = gas * gasPrice;
  } catch {
    gasCost = 0n;
  }

  const enoughGas = deposit.tokenContract
    ? gasCost > 0n
      ? nativeBalance >= gasCost
      : nativeBalance > 0n
    : gasCost > 0n
      ? nativeBalance >= amount + gasCost
      : nativeBalance > amount;

  let shortfall: string | undefined;
  if (!enoughToken) {
    shortfall = deposit.tokenContract
      ? tokenShortfall(
          amount,
          tokenBalance ?? 0n,
          deposit.decimals,
          deposit.symbol,
        )
      : tokenShortfall(amount, nativeBalance, nativeDecimals, nativeSymbol);
  } else if (!enoughGas) {
    // A wallet whose RPC cannot estimate still needs a visible gas figure.
    // 0.0001 native is deliberately conservative and only advisory.
    const gasNeed = deposit.tokenContract
      ? gasCost > 0n
        ? gasCost
        : 10n ** 14n
      : amount + (gasCost > 0n ? gasCost : 10n ** 14n);
    shortfall = gasShortfall(
      gasNeed,
      nativeBalance,
      nativeDecimals,
      nativeSymbol,
      !deposit.tokenContract,
    );
  }

  return {
    tokenBalance,
    nativeBalance,
    enoughToken,
    enoughGas,
    shortfall,
  };
}

async function sendEvmDeposit(input: {
  provider: RequestProvider;
  address: Address;
  chain: Chain;
  publicClient: PublicClient;
  deposit: FundingSendInput;
}): Promise<FundingSendResult> {
  const { provider, address, chain, publicClient, deposit } = input;
  await ensureChain(provider, chain);
  const wallet = createWalletClient({
    account: address,
    chain,
    transport: custom(provider),
  });
  const amount = BigInt(deposit.amountRaw);
  const hash = deposit.tokenContract
    ? await wallet.writeContract({
        address: deposit.tokenContract as Address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [deposit.address as Address, amount],
      })
    : await wallet.sendTransaction({
        to: deposit.address as Address,
        value: amount,
      });
  try {
    // The card owns the status poll; the receipt only makes the dialog wait
    // until the transfer is actually mined, never to decide the outcome.
    await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
    });
  } catch {
    // Broadcast is enough to register the hash.
  }
  return { txHash: hash };
}

export type EvmFundingConnectInput = {
  provider: EvmProvider;
  deposit: FundingDeposit;
  walletName?: string;
  walletIcon?: string;
  /** False when reusing an already-authorised app wallet. */
  requestAccounts?: boolean;
};

/**
 * Connect an EVM funding wallet through its own EIP-1193 provider.
 *
 * This never touches wagmi or the app's connected account. The provider is
 * the one the user picked from the funding catalog, and every read and send
 * goes through it.
 */
export async function connectEvmFunding(
  input: EvmFundingConnectInput,
): Promise<FundingConnection> {
  const chainRef = evmFundingChain(input.deposit);
  if (!chainRef?.chain || !input.deposit.chainId) {
    throw new Error("unsupported-network");
  }
  const chain = chainRef.chain;
  const address = (await requestAccounts(
    input.provider,
    input.requestAccounts === false ? "existing" : "request",
  )) as Address;
  // The provider may be the app's own wallet object or a separate one; either
  // way the grant is site-wide in the extension. Sign-out revokes it so the
  // funding wallet cannot bleed into the next login.
  trackFundingConnection(async () => {
    await input.provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  });
  const publicClient = createPublicClient({
    chain,
    transport: custom(input.provider),
  });
  return {
    kind: "evm",
    address,
    walletName: input.walletName,
    walletIcon: input.walletIcon,
    chainId: chain.id,
    check: (deposit) =>
      (async () => {
        const current = await readChainId(input.provider);
        if (current !== null && current !== chain.id) {
          return {
            wrongNetwork: true,
            currentChainId: current,
            tokenBalance: null,
            nativeBalance: null,
            enoughToken: false,
            enoughGas: false,
          } satisfies FundingCheck;
        }
        return checkEvmDeposit({
          client: publicClient,
          address,
          chain,
          deposit,
        });
      })(),
    send: (deposit) =>
      sendEvmDeposit({
        provider: input.provider,
        address,
        chain,
        publicClient,
        deposit,
      }),
    switchNetwork: () => ensureChain(input.provider, chain),
  };
}

/**
 * Reuse the app's already-connected EVM account.
 *
 * No connection prompt is issued: the address is the one the app already
 * holds, balance reads use a public client for the deposit chain, and the card
 * supplies the send continuation through its own wallet adapter.
 */
export function createConnectedEvmFunding(input: {
  address: string;
  deposit: FundingDeposit;
  send: (input: FundingSendInput) => Promise<FundingSendResult>;
  walletName?: string;
  walletIcon?: string;
}): FundingConnection {
  const chainRef = evmFundingChain(input.deposit);
  if (!chainRef?.chain || !input.deposit.chainId) {
    throw new Error("unsupported-network");
  }
  const chain = chainRef.chain;
  const client = createPublicClient({ chain, transport: http() });
  return {
    kind: "evm",
    address: input.address,
    walletName: input.walletName,
    walletIcon: input.walletIcon,
    connected: true,
    chainId: chain.id,
    check: (deposit) =>
      checkEvmDeposit({
        client,
        address: input.address as Address,
        chain,
        deposit,
      }),
    send: input.send,
  };
}
