"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChartBar, IconCheck, IconChevronDown, IconCopy, IconLoader2, IconLogout, IconUser, IconWallet, IconX } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { OPEN_WALLET_EVENT } from "@/components/app/ConnectGate";
import { useWallet } from "@/lib/wallet/registry";

/**
 * The wallet control.
 *
 * Disconnected it is a primary button that opens a centred picker: a chain
 * rail on the left, and a wallet card for each wallet the browser offers on
 * the right. Connected it is a secondary button showing the truncated
 * address, with an inline menu for the account actions.
 */
export function WalletButton({
  onProfile,
  onUsage,
}: {
  onProfile?: () => void;
  onUsage?: () => void;
} = {}) {
  const wallet = useWallet();
  const { account, connected, pendingChain, authStage, isPending } = wallet;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // The gated assistant reply carries its own inline connect action, so the
  // footer control listens for the same open request.
  useEffect(() => {
    const open = () => setPickerOpen(true);
    window.addEventListener(OPEN_WALLET_EVENT, open);
    return () => window.removeEventListener(OPEN_WALLET_EVENT, open);
  }, []);

  // The picker must stay mounted through approval AND signature. The wallet
  // account appears as soon as the connection is approved, which is before
  // the verification signature lands — unmounting here is what closed the
  // popup early. One wallet instance is shared with the picker so the busy
  // and stage flags are the same object the connection updates.
  const busy = isPending || pendingChain !== null || authStage !== null;
  if (pickerOpen) {
    return (
      <>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="w-full active:scale-[0.99]"
          onClick={() => setPickerOpen(true)}
        >
          <IconWallet size={15} stroke={1.8} className="shrink-0" />
          Connect Wallet
        </Button>
        <ConnectPicker
          wallet={wallet}
          onClose={() => {
            if (!busy) setPickerOpen(false);
          }}
        />
      </>
    );
  }

  if (connected && account) {
    return (
      <AccountMenu
        address={account.address}
        open={menuOpen}
        onToggle={() => setMenuOpen((v) => !v)}
        onClose={() => setMenuOpen(false)}
        onDisconnect={() => void wallet.disconnect()}
        onProfile={onProfile}
        onUsage={onUsage}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="primary"
      size="md"
      className="w-full active:scale-[0.99]"
      onClick={() => setPickerOpen(true)}
    >
      <IconWallet size={15} stroke={1.8} className="shrink-0" />
      Connect Wallet
    </Button>
  );
}

function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function AccountMenu({
  address,
  open,
  onToggle,
  onClose,
  onDisconnect,
  onProfile,
  onUsage,
}: {
  address: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDisconnect: () => void;
  onProfile?: () => void;
  onUsage?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyAddress = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(address);
        setCopied(true);
      } catch {
        /* clipboard unavailable — leave the row unchanged */
      }
    })();
  };

  const itemClass =
    "flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[13.5px] text-ink hover:bg-hover-2";

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="secondary"
        size="md"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full font-mono text-[12px] active:scale-[0.99]"
      >
        <IconUser size={14} stroke={1.8} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate text-left">
          {truncateAddress(address)}
        </span>
        <IconChevronDown size={14} stroke={1.8} className="shrink-0 text-ink-3" />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-1.5 w-full rounded-[14px] bg-surface p-1.5 shadow-overlay"
          style={{
            animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
            transformOrigin: "bottom center",
          }}
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={copyAddress}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
              {copied ? <IconCheck size={16} stroke={1.8} /> : <IconCopy size={16} stroke={1.8} />}
            </span>
            <span className="min-w-0 flex-1 truncate">{copied ? "Copied" : "Copy address"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              onClose();
              onProfile?.();
            }}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
              <IconUser size={16} stroke={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate">Profile</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              onClose();
              onUsage?.();
            }}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
              <IconChartBar size={16} stroke={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate">Usage</span>
          </button>
          <div role="group" aria-label="Theme" className="flex h-9 w-full items-center gap-1.5 px-2 text-[13.5px] text-ink">
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate">Theme</span>
            <ThemeToggle compact />
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-red hover:bg-red-tint`}
            onClick={() => {
              onClose();
              onDisconnect();
            }}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <IconLogout size={16} stroke={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate">Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function friendlyWalletError(cause: unknown, stage?: string | null): string {
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
  if (/reject|cancel|denied|dismiss/i.test(raw)) {
    return "Wallet connection rejected. Please try again.";
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
function WalletIcon({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-accent-tint text-[12px] font-semibold text-accent-ink"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // Logos are static files the operator saves into `public/wallets/`.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      className="size-7 shrink-0 rounded-[7px] object-contain"
    />
  );
}

const CHAINS = [
  { id: "evm", label: "EVM", icon: "/wallets/evm.webp" },
  { id: "solana", label: "Solana", icon: "/wallets/solana.webp" },
  { id: "near", label: "Near", icon: "/wallets/near.webp" },
] as const;

/** Popular wallets worth suggesting even when the browser offers none.
 * Drop a square logo at the matching path in `public/wallets/` and the card
 * Detection is by connector name first (EIP-6963) with the legacy provider
 * flag as a fallback, so entries without a known flag still resolve. */
type SuggestEntry = {
  id: string;
  name: string;
  match: string;
  flag?: string;
  icon: string;
};

const EVM_CATALOG: SuggestEntry[] = [
  { id: "metamask", name: "MetaMask", match: "metamask", flag: "isMetaMask", icon: "/wallets/metamask.webp" },
  { id: "coinbase", name: "Coinbase Wallet", match: "coinbase", flag: "isCoinbaseWallet", icon: "/wallets/coinbase.webp" },
  { id: "rainbow", name: "Rainbow", match: "rainbow", flag: "isRainbow", icon: "/wallets/rainbow.webp" },
  { id: "rabby", name: "Rabby", match: "rabby", flag: "isRabby", icon: "/wallets/rabby.webp" },
  { id: "okx", name: "OKX Wallet", match: "okx", flag: "isOKExWallet", icon: "/wallets/okx.webp" },
  { id: "tokenpocket", name: "TokenPocket", match: "tokenpocket", flag: "isTokenPocket", icon: "/wallets/tokenpocket.webp" },
  { id: "ambire", name: "Ambire", match: "ambire", icon: "/wallets/ambire.webp" },
  { id: "safepal", name: "SafePal", match: "safepal", icon: "/wallets/safepal.webp" },
  { id: "bitget", name: "Bitget Wallet", match: "bitget", icon: "/wallets/bitget.webp" },
  { id: "gate", name: "Gate Wallet", match: "gate", icon: "/wallets/gate.webp" },
  { id: "pelagus", name: "Pelagus", match: "pelagus", icon: "/wallets/pelagus.webp" },
  { id: "subwallet", name: "SubWallet", match: "subwallet", icon: "/wallets/subwallet.webp" },
  { id: "talisman", name: "Talisman", match: "talisman", icon: "/wallets/talisman.webp" },
];

const SOL_CATALOG: SuggestEntry[] = [
  { id: "phantom", name: "Phantom", match: "phantom", icon: "/wallets/phantom.webp" },
  { id: "solflare", name: "Solflare", match: "solflare", icon: "/wallets/solflare.webp" },
  { id: "backpack", name: "Backpack", match: "backpack", icon: "/wallets/backpack.webp" },
  { id: "jupiter", name: "Jupiter", match: "jupiter", icon: "/wallets/jupiter.webp" },
  { id: "nightly", name: "Nightly", match: "nightly", icon: "/wallets/nightly.webp" },
];

function readInjectedProvider(): {
  flags: Record<string, unknown>;
  exists: boolean;
} {
  if (typeof window === "undefined") return { flags: {}, exists: false };
  const ethereum = (window as unknown as { ethereum?: unknown }).ethereum as
    | ({ providers?: unknown } & Record<string, unknown>)
    | undefined;
  if (!ethereum) return { flags: {}, exists: false };
  const providers = Array.isArray(ethereum.providers)
    ? (ethereum.providers as Record<string, unknown>[])
    : [ethereum];
  const flags: Record<string, unknown> = {};
  for (const provider of providers) {
    if (provider && typeof provider === "object") {
      for (const [key, value] of Object.entries(provider)) {
        if (value) flags[key] = value;
      }
    }
  }
  return { flags, exists: true };
}

function ConnectPicker({
  wallet,
  onClose,
}: {
  wallet: ReturnType<typeof useWallet>;
  onClose: () => void;
}) {
  const {
    connectEvm,
    connectSolanaWallet,
    connectNear,
    pendingChain,
    isPending,
    authStage,
    solanaWallets,
    evmConnectors,
  } = wallet;
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [chain, setChain] = useState<"evm" | "solana">("evm");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const stageRef = useRef<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (authStage) stageRef.current = authStage;
  }, [authStage]);

  if (!mounted) return null;

  const busy = isPending || pendingChain !== null || authStage !== null;

  // One notice slot serves every state, so the dialog extends the same way
  // whether it is asking for approval, asking for a signature, or reporting
  // the outcome.
  const pendingNotice =
    pendingKey !== null && !error && !success
      ? authStage === "verify"
        ? "Sign message to verify ownership…"
        : "Approve connection in your wallet…"
      : null;
  const notice = error ?? success ?? pendingNotice;

  const choose = (key: string, run: () => Promise<unknown>) => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setError(null);
    setSuccess(null);
    setPendingKey(key);
    stageRef.current = null;
    void run()
      .then(() => {
        // The picker stays open on the confirmation, then dismisses itself.
        setSuccess("Connected successfully.");
        closeTimer.current = window.setTimeout(onClose, 1200);
      })
      .catch((cause: unknown) =>
        setError(friendlyWalletError(cause, stageRef.current)),
      )
      .finally(() => setPendingKey(null));
  };

  const cardClass =
    "flex min-w-0 items-center gap-2.5 rounded-[8px] border border-line bg-page px-3.5 py-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-hover disabled:opacity-60";

  const tabClass = (selected: boolean) =>
    `flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-3 text-left text-[13px] font-medium transition-colors duration-100 disabled:opacity-60 ${
      selected
        ? "bg-hover-2 text-ink"
        : "text-ink-2 hover:bg-hover hover:text-ink"
    }`;

  const spin = (key: string) =>
    pendingKey === key ? (
      <IconLoader2
        size={14}
        stroke={1.8}
        className="shrink-0 animate-spin text-ink-3"
      />
    ) : null;

  const notInstalled = (name: string) =>
    setError(`${name} was not detected. Install it to continue.`);

  // Connectors with icons (such as a WalletConnect QR option) join the cards.
  const evmCards = evmConnectors.filter((connector) => connector.icon);
  const { flags: injectedFlags, exists: hasInjected } = readInjectedProvider();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet to connect"
    >
      <div
        className="absolute inset-0 bg-black/60 dark:bg-black/75"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={onClose}
      />
      <div
        className="relative flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-window border border-line bg-surface shadow-overlay"
        style={{ animation: "dialog-in 240ms var(--ease-out-strong) both" }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2.5">
          <span className="text-[13px] font-semibold text-ink">
            Choose a wallet to connect.
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
            className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3"
          >
            <IconX size={15} />
          </button>
        </div>

        <div className="flex min-h-[264px]">
          <div className="w-[124px] shrink-0 border-r border-line p-1.5 sm:w-[148px]">
            {CHAINS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  // NEAR brings its own wallet modal, so it connects directly
                  // instead of listing cards.
                  if (item.id === "near") choose("near", () => connectNear());
                  else setChain(item.id);
                }}
                className={tabClass(item.id !== "near" && chain === item.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.icon}
                  alt=""
                  aria-hidden
                  className="size-6 shrink-0 rounded-[6px] object-contain"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.id === "near" ? spin("near") : null}
              </button>
            ))}
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1.5">
            {chain === "evm" ? (
              <>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {evmCards.map((connector) => {
                    const key = `evm:${connector.id}`;
                    return (
                      <button
                        key={connector.id}
                        type="button"
                        disabled={busy}
                        onClick={() => choose(key, () => connectEvm(connector.id))}
                        className={cardClass}
                      >
                        {connector.icon ? (
                          // The icon arrives from the connector itself.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={connector.icon}
                            alt=""
                            aria-hidden
                            className="size-7 shrink-0 rounded-[7px]"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                          {connector.name}
                        </span>
                        {spin(key)}
                      </button>
                    );
                  })}
                  {EVM_CATALOG.filter(
                    (entry) =>
                      !evmConnectors.some(
                        (connector) =>
                          connector.icon &&
                          connector.name.toLowerCase().includes(entry.match),
                      ),
                  )
                    // Detected wallets render above; three suggestions at most.
                    .slice(0, 3)
                    .map((entry) => {
                    const key = `evm:${entry.id}`;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const target = evmConnectors.find((connector) =>
                            connector.name.toLowerCase().includes(entry.match),
                          );
                          if (target) choose(key, () => connectEvm(target.id));
                          else if (entry.flag && injectedFlags[entry.flag])
                            choose(key, () => connectEvm());
                          else notInstalled(entry.name);
                        }}
                        className={cardClass}
                      >
                        <WalletIcon src={entry.icon} name={entry.name} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                          {entry.name}
                        </span>
                        {spin(key)}
                      </button>
                    );
                  })}
                </div>
                {hasInjected ? (
                  <>
                    <div
                      aria-hidden
                      className="mx-auto my-2 h-px w-2/3 bg-gradient-to-r from-transparent via-line to-transparent"
                    />
                    <div className="flex justify-center pb-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => choose("evm:injected", () => connectEvm())}
                        className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-page px-4 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-100 hover:border-line-strong hover:text-ink disabled:opacity-60"
                      >
                        <IconWallet size={14} stroke={1.8} className="shrink-0" />
                        Injected
                        {spin("evm:injected")}
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {solanaWallets.map((wallet) => {
                  const key = `sol:${wallet.name}`;
                  return (
                    <button
                      key={wallet.name}
                      type="button"
                      disabled={busy}
                      onClick={() => choose(key, () => connectSolanaWallet(wallet))}
                      className={cardClass}
                    >
                      {wallet.icon ? (
                        // The icon arrives as a data URI from the wallet itself.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={wallet.icon}
                          alt=""
                          aria-hidden
                          className="size-7 shrink-0 rounded-[7px]"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                        {wallet.name}
                      </span>
                      {spin(key)}
                    </button>
                  );
                })}
                {SOL_CATALOG.filter(
                  (entry) =>
                    !solanaWallets.some((wallet) =>
                      wallet.name.toLowerCase().includes(entry.match),
                    ),
                )
                  // Detected wallets render above; three suggestions at most.
                  .slice(0, 3)
                  .map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={busy}
                    onClick={() => notInstalled(entry.name)}
                    className={cardClass}
                  >
                    <WalletIcon src={entry.icon} name={entry.name} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                      {entry.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className="grid shrink-0"
          style={{
            gridTemplateRows: notice ? "1fr" : "0fr",
            transition: "grid-template-rows 240ms var(--ease-out-strong)",
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-line px-4 py-3">
              <p
                key={notice}
                className={`text-center text-[12.5px] leading-relaxed ${error ? "text-red" : "text-ink"}`}
                style={{ animation: "fade-in 180ms ease-out both" }}
              >
                {notice}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
