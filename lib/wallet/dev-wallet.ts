"use client";

import {
  createPublicClient,
  createWalletClient,
  http,
  numberToHex,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  gnosis,
  mainnet,
  optimism,
  polygon,
  scroll,
} from "viem/chains";

/**
 * A local wallet for development, driven by a private key.
 *
 * The picker talks to `window.ethereum`, and the verifier checks a real
 * ERC-191 signature, so a key held in the browser is the difference between
 * testing the auth flow and reading it. This installs such a provider before
 * the wallet stack boots: connect, sign in, switch account, and sign out all
 * run through the same code paths as a browser extension.
 *
 * It is inert unless `NEXT_PUBLIC_DEV_WALLET_KEY` is set, and it refuses to
 * run in a production build. The key is inlined into the client bundle by
 * design — the browser has to sign with it — so it is only ever safe as a
 * throwaway account holding the amount you are willing to lose.
 */

const CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
  [base.id]: base,
  [optimism.id]: optimism,
  [polygon.id]: polygon,
  [bsc.id]: bsc,
  [avalanche.id]: avalanche,
  [gnosis.id]: gnosis,
  [scroll.id]: scroll,
};

type Listener = (...args: unknown[]) => void;

export type DevWalletHandle = {
  address: Hex;
  chainId: number;
  /** Swap the signing key at runtime, as a wallet account switch would. */
  switchAccount: (privateKey: Hex) => void;
  /** Forget the switched key and go back to the one in the env. */
  resetAccount: () => void;
  /** Emit an EIP-1193 event, for testing listeners. */
  emit: (event: string, ...args: unknown[]) => void;
};

declare global {
  interface Window {
    ethereum?: unknown;
    __devWallet?: DevWalletHandle;
  }
}

/**
 * A switched account has to survive a navigation, or every cross-page test
 * silently starts again as the env key. Scoped to the tab, so two tabs can
 * hold two different accounts.
 */
const OVERRIDE_KEY = "myntle:dev-wallet-key";

function storedKey(): Hex | null {
  try {
    const value = window.sessionStorage.getItem(OVERRIDE_KEY);
    return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as Hex) : null;
  } catch {
    return null;
  }
}

export function installDevWallet(rawKey: string): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "production") return;

  // Pasted keys arrive with and without the prefix; accept both.
  const privateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;

  let account = privateKeyToAccount(storedKey() ?? privateKey);
  let chain: Chain = mainnet;
  // A real extension keeps its site grant until the site revokes it, so the
  // account is only advertised while this wallet has authorised the page.
  let authorised = true;
  const listeners = new Map<string, Set<Listener>>();

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };

  const walletFor = (target: Chain) =>
    createWalletClient({ account, chain: target, transport: http() });

  const provider = {
    // Enough of the MetaMask surface for the picker to classify this as a
    // detected wallet instead of a suggestion with an install link.
    isMetaMask: true,
    isDevWallet: true,

    async request({
      method,
      params,
    }: {
      method: string;
      params?: unknown[];
    }): Promise<unknown> {
      switch (method) {
        case "eth_requestAccounts":
          authorised = true;
          return [account.address];

        case "eth_accounts":
          return authorised ? [account.address] : [];

        case "wallet_revokePermissions":
          // MetaMask's disconnect method. wagmi calls it on sign-out and
          // treats an empty account list as the connection ending.
          authorised = false;
          emit("accountsChanged", []);
          return null;

        case "eth_chainId":
          return numberToHex(chain.id);

        case "net_version":
          return String(chain.id);

        // wagmi sends raw bytes for `signMessage({ message: { raw } })`,
        // which is what the sign-in challenge uses.
        case "personal_sign":
        case "eth_sign":
          return walletFor(chain).signMessage({
            message: { raw: params?.[0] as Hex },
          });

        case "eth_sendTransaction": {
          const tx = (params?.[0] ?? {}) as {
            to?: Hex;
            data?: Hex;
            value?: Hex;
            gas?: Hex;
          };
          return walletFor(chain).sendTransaction({
            account,
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
        }

        case "wallet_switchEthereumChain": {
          const requested = (params?.[0] as { chainId?: string } | undefined)
            ?.chainId;
          const next = requested ? CHAINS[Number(requested)] : undefined;
          if (!next) throw new Error("dev wallet: unknown chain");
          chain = next;
          emit("chainChanged", numberToHex(chain.id));
          return null;
        }

        case "wallet_addEthereumChain":
          return null;

        // Everything else is a read. A real wallet proxies these to the
        // network, so this does too, and the provider stays usable for
        // balance, gas and receipt lookups without a method whitelist.
        default: {
          const client = createPublicClient({ chain, transport: http() });
          return client.request({
            method,
            params,
          } as Parameters<typeof client.request>[0]);
        }
      }
    },

    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
    },

    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
    },
  };

  // The key was asked for explicitly, so it wins over an installed
  // extension: a test that silently used MetaMask would be worse than none.
  window.ethereum = provider;

  window.__devWallet = {
    get address() {
      return account.address;
    },
    get chainId() {
      return chain.id;
    },
    switchAccount(nextKey: Hex) {
      const normalized = (nextKey.startsWith("0x")
        ? nextKey
        : `0x${nextKey}`) as Hex;
      account = privateKeyToAccount(normalized);
      try {
        window.sessionStorage.setItem(OVERRIDE_KEY, normalized);
      } catch {
        // Storage unavailable: the switch still applies to this page.
      }
      emit("accountsChanged", [account.address]);
    },
    resetAccount() {
      try {
        window.sessionStorage.removeItem(OVERRIDE_KEY);
      } catch {
        // Nothing stored to clear.
      }
    },
    emit,
  };

  console.warn(
    `[dev wallet] signing as ${account.address}. ` +
      `Only ever point this at a throwaway key.`,
  );
}
