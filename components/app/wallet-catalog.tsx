"use client";

import { useEffect, useState } from "react";

/**
 * The wallet catalogue shared by the account picker and the funding dialog.
 *
 * The login picker also knows about wagmi connectors and passkeys; this module
 * deliberately does not. It holds only the chain list, the wallet brands, the
 * injected/EIP-6963 discovery, and the logo preload, so a second surface can
 * offer the same wallets without importing the auth flow.
 */

export function friendlyWalletError(cause: unknown, stage?: string | null): string {
  const raw = cause instanceof Error ? cause.message : "";
  if (/reject|cancel|denied|dismiss|rejected/i.test(raw)) {
    if (stage === "verify") {
      return "Signature request was rejected. Please try again.";
    }
    return "Wallet connection rejected. Please try again.";
  }
  if (/verif|signatur|challenge|expired|nonce/i.test(raw)) {
    return raw || "Signature could not be verified. Please try again.";
  }
  if (/disconnect/i.test(raw)) {
    return "Wallet disconnected. Please reconnect.";
  }
  if (/no .*wallet|not found|not installed|not detected|not available/i.test(raw)) {
    return "Wallet not detected. Please try again.";
  }
  return "Unable to connect wallet.";
}

/**
 * A wallet logo from `public/wallets/`, falling back to a monogram tile
 * until the file is saved. Drop a square PNG or SVG at the catalog path
 * (for example `public/wallets/metamask.png`) and the card picks it up
 * with no code change.
 */
export function WalletIcon({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center text-[12px] font-semibold text-accent-ink"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // Logos are static files the operator saves into `public/wallets/`.
    // They are preloaded on mount (see WALLET_LOGO_SOURCES) so the card
    // never waits on the network.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      loading="eager"
      fetchPriority="high"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="size-7 shrink-0 object-contain"
    />
  );
}

export const CHAINS = [
  { id: "evm", label: "EVM", icon: "/wallets/evm.webp" },
  { id: "solana", label: "Solana", icon: "/wallets/solana.webp" },
  { id: "near", label: "Near", icon: "/wallets/near.webp" },
] as const;

/** Popular wallets worth suggesting even when the browser offers none.
 * Drop a square logo at the matching path in `public/wallets/` and the card
 * Detection is by connector name first (EIP-6963) with the legacy provider
 * flag as a fallback, so entries without a known flag still resolve. */
export type SuggestEntry = {
  id: string;
  name: string;
  match: string;
  flags?: readonly string[];
  rdns?: string;
  icon: string;
  installUrl: string;
};

export const EVM_CATALOG: SuggestEntry[] = [
  { id: "metamask", name: "MetaMask", match: "metamask", flags: ["isMetaMask"], rdns: "io.metamask", icon: "/wallets/metamask.webp", installUrl: "https://www.alchemy.com/dapps/metamask" },
  { id: "coinbase", name: "Coinbase Wallet", match: "coinbase", flags: ["isCoinbaseWallet", "isCoinbaseBrowser"], rdns: "com.coinbase.wallet", icon: "/wallets/coinbase.webp", installUrl: "https://www.alchemy.com/dapps/coinbase-wallet" },
  { id: "rainbow", name: "Rainbow", match: "rainbow", flags: ["isRainbow"], rdns: "me.rainbow", icon: "/wallets/rainbow.webp", installUrl: "https://www.alchemy.com/dapps/rainbow-wallet" },
  { id: "rabby", name: "Rabby", match: "rabby", flags: ["isRabby"], rdns: "io.rabby", icon: "/wallets/rabby.webp", installUrl: "https://www.alchemy.com/dapps/rabby-wallet" },
  { id: "hot", name: "HOT Wallet", match: "hot", flags: ["isHotWallet", "isHOTWallet", "isHot", "isHOT"], icon: "/wallets/hot.webp", installUrl: "https://hot-labs.org/wallet" },
  { id: "ambire", name: "Ambire", match: "ambire", flags: ["isAmbire", "isAmbireWallet"], icon: "/wallets/ambire.webp", installUrl: "https://www.ambire.com" },
  { id: "okx", name: "OKX Wallet", match: "okx", flags: ["isOKExWallet", "isOkxWallet", "isOKXWallet"], rdns: "com.okx.wallet", icon: "/wallets/okx.webp", installUrl: "https://www.alchemy.com/dapps/okx-wallet" },
  { id: "tokenpocket", name: "TokenPocket", match: "tokenpocket", flags: ["isTokenPocket"], icon: "/wallets/tokenpocket.webp", installUrl: "https://www.alchemy.com/dapps/tokenpocket" },
  { id: "safepal", name: "SafePal", match: "safepal", icon: "/wallets/safepal.webp", installUrl: "https://www.alchemy.com/dapps/safepal" },
  { id: "bitget", name: "Bitget Wallet", match: "bitget", icon: "/wallets/bitget.webp", installUrl: "https://www.alchemy.com/dapps/bitget-wallet" },
  { id: "gate", name: "Gate Wallet", match: "gate", icon: "/wallets/gate.webp", installUrl: "https://web3.gate.com" },
  { id: "pelagus", name: "Pelagus", match: "pelagus", icon: "/wallets/pelagus.webp", installUrl: "https://www.pelaguswallet.io" },
  { id: "subwallet", name: "SubWallet", match: "subwallet", icon: "/wallets/subwallet.webp", installUrl: "https://www.alchemy.com/dapps/subwallet" },
  { id: "talisman", name: "Talisman", match: "talisman", icon: "/wallets/talisman.webp", installUrl: "https://www.alchemy.com/dapps/talisman-wallet" },
];

export const SOL_CATALOG: SuggestEntry[] = [
  { id: "phantom", name: "Phantom", match: "phantom", icon: "/wallets/phantom.webp", installUrl: "https://www.alchemy.com/dapps/phantom" },
  { id: "solflare", name: "Solflare", match: "solflare", icon: "/wallets/solflare.webp", installUrl: "https://www.alchemy.com/dapps/solflare" },
  { id: "backpack", name: "Backpack", match: "backpack", icon: "/wallets/backpack.webp", installUrl: "https://www.alchemy.com/dapps/backpack" },
  { id: "jupiter", name: "Jupiter", match: "jupiter", icon: "/wallets/jupiter.webp", installUrl: "https://jup.ag" },
  { id: "nightly", name: "Nightly", match: "nightly", icon: "/wallets/nightly.webp", installUrl: "https://nightly.app" },
];

/**
 * Every logo the picker can show, warmed before the dialog opens.
 *
 * The files are 2–3 KB webp, so the cost is one burst of cache fills on
 * first paint rather than a visible fetch per card when the dialog opens.
 */
const WALLET_LOGO_SOURCES: readonly string[] = [
  ...CHAINS.map((c) => c.icon),
  ...EVM_CATALOG.map((e) => e.icon),
  ...SOL_CATALOG.map((e) => e.icon),
];

let walletLogosPreloaded = false;

export function preloadWalletLogos() {
  if (typeof window === "undefined" || walletLogosPreloaded) return;
  walletLogosPreloaded = true;
  for (const src of WALLET_LOGO_SOURCES) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
}

/** Warm the cache during idle time, once per session. */
export function scheduleWalletLogoPreload() {
  if (walletLogosPreloaded) return;
  if ("requestIdleCallback" in window) {
    const id = (
      window as unknown as {
        requestIdleCallback: (cb: () => void) => number;
      }
    ).requestIdleCallback(preloadWalletLogos);
    return () =>
      (
        window as unknown as { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback?.(id);
  }
  preloadWalletLogos();
}

export function getInjectedProviders(): Record<string, unknown>[] {
  if (typeof window === "undefined") return [];
  const ethereum = (window as unknown as { ethereum?: unknown }).ethereum as
    | ({ providers?: unknown } & Record<string, unknown>)
    | undefined;
  if (!ethereum) return [];
  const providers = Array.isArray(ethereum.providers)
    ? (ethereum.providers as Record<string, unknown>[])
    : [ethereum];
  return providers.filter((p) => p && typeof p === "object");
}

export type Eip6963Detail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: unknown;
};

/** Direct EIP-6963 discovery, independent of wagmi's MIPD store. */
export function useEip6963Providers(): Eip6963Detail[] {
  const [providers, setProviders] = useState<Eip6963Detail[]>([]);
  useEffect(() => {
    const seen = new Map<string, Eip6963Detail>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.info?.uuid || seen.has(detail.info.uuid)) return;
      seen.set(detail.info.uuid, detail);
      setProviders([...seen.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Late-injecting wallets announce after load; ask once more.
    const timer = window.setTimeout(
      () => window.dispatchEvent(new Event("eip6963:requestProvider")),
      500,
    );
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.clearTimeout(timer);
    };
  }, []);
  return providers;
}

// Wallets that set `isMetaMask` for compatibility without being MetaMask.
// A provider only counts as MetaMask when none of these are present.
const METAMASK_IMPOSTER_FLAGS = [
  "isApexWallet",
  "isAvalanche",
  "isBitKeep",
  "isBlockWallet",
  "isBraveWallet",
  "isCoinbaseWallet",
  "isKuCoinWallet",
  "isMathWallet",
  "isOkxWallet",
  "isOKExWallet",
  "isOneInchIOSWallet",
  "isOneInchAndroidWallet",
  "isOpera",
  "isPhantom",
  "isPortal",
  "isRabby",
  "isRainbow",
  "isTokenPocket",
  "isTokenary",
  "isUniswapWallet",
  "isZerion",
  "isAmbire",
  "isAmbireWallet",
  "isHotWallet",
  "isHOTWallet",
];

export function providerHasFlag(
  provider: Record<string, unknown>,
  entry: SuggestEntry,
): boolean {
  if (!entry.flags?.length) return false;
  // MetaMask is claimed by several wallets for compatibility. Only a
  // provider with `isMetaMask` and none of the imposter flags counts.
  if (entry.id === "metamask") {
    if (!provider["isMetaMask"]) return false;
    return !METAMASK_IMPOSTER_FLAGS.some((flag) => provider[flag]);
  }
  return entry.flags.some((flag) => !!provider[flag]);
}

/** True when the wallet app name looks like this catalogue entry. */
export function catalogEntryMatchesWallet(
  entry: SuggestEntry,
  walletName: string | null | undefined,
): boolean {
  if (!walletName) return false;
  const name = walletName.toLowerCase();
  return (
    entry.name.toLowerCase() === name ||
    name.includes(entry.match) ||
    entry.name.toLowerCase().includes(name)
  );
}

/** The EIP-6963 provider a catalogue card targets, when it announced. */
export function eip6963ProviderForEntry(
  entry: SuggestEntry,
  providers: readonly Eip6963Detail[],
): Eip6963Detail | null {
  return (
    providers.find(
      (detail) =>
        (entry.rdns &&
          detail.info.rdns.toLowerCase() === entry.rdns.toLowerCase()) ||
        detail.info.name.toLowerCase().includes(entry.match),
    ) ?? null
  );
}

/** The legacy injected provider a catalogue card targets, when it exists. */
export function injectedProviderForEntry(
  entry: SuggestEntry,
  providers: readonly Record<string, unknown>[],
): Record<string, unknown> | null {
  return providers.find((provider) => providerHasFlag(provider, entry)) ?? null;
}
