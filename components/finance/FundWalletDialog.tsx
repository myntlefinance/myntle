"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  IconExternalLink,
  IconLoader2,
  IconWallet,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { WalletPickerDialog } from "@/components/app/WalletPickerDialog";
import {
  CHAINS,
  EVM_CATALOG,
  SOL_CATALOG,
  WalletIcon,
  catalogEntryMatchesWallet,
  eip6963ProviderForEntry,
  scheduleWalletLogoPreload,
  useEip6963Providers,
  type Eip6963Detail,
  type SuggestEntry,
} from "@/components/app/wallet-catalog";
import {
  depositNetworkLabel,
  type DepositMetadata,
  type DepositWalletKind,
} from "@/lib/intents/deposit-metadata";
import { evmChainForId, evmChainForSlug } from "@/lib/wallet/evm-chains";
import {
  connectEvmFunding,
  connectNearFunding,
  connectSolanaFunding,
  createConnectedEvmFunding,
  createConnectedNearFunding,
  createConnectedSolanaFunding,
  formatRawAmount,
  friendlyFundingError,
  fundingActionsForState,
  fundingStateForCheck,
  shortAddress,
  type FundingAction,
  type FundingCheck,
  type FundingConnection,
  type FundingDeposit,
  type FundingSendInput,
  type FundingSendResult,
  type FundingState,
} from "@/lib/wallet/funding";
import { useWallet } from "@/lib/wallet/registry";
import type { ConnectedWallet } from "@/lib/wallet/types";
import type { Wallet } from "@wallet-standard/base";

/**
 * The wallet a deposit is funded from.
 *
 * This is a connector, not a login: it never calls sign-in, never creates a
 * passkey, and never replaces the wallet the application is signed in with.
 * The selected wallet only reads its balance and, after an explicit Send,
 * broadcasts one transfer to the deposit address.
 */
export type FundWalletDialogProps = {
  deposit: DepositMetadata;
  chainKind: DepositWalletKind;
  connected: ConnectedWallet | null;
  onClose: () => void;
  onUseQr: () => void;
  /** The card owns send + registration + the processing transition. */
  onFund: (connection: FundingConnection) => Promise<void>;
  /** The already-connected wallet keeps the app's existing send path. */
  onSendConnected: (input: FundingSendInput) => Promise<FundingSendResult>;
  /** The deposit record is verified, waiting, and inside its funding window. */
  depositReady: boolean;
};

/** The exact fields the funding layer may use, or nothing. */
export function fundingDepositFor(
  meta: DepositMetadata,
): FundingDeposit | null {
  if (!meta.address || !meta.amountInRaw || !/^[1-9]\d*$/.test(meta.amountInRaw)) {
    return null;
  }
  if (
    typeof meta.decimals !== "number" ||
    !Number.isInteger(meta.decimals) ||
    meta.decimals < 0 ||
    meta.decimals > 36 ||
    !meta.symbol
  ) {
    return null;
  }
  const evmChain = evmChainForSlug(meta.chainSlug);
  if (evmChain && meta.chainId && evmChain.id !== meta.chainId) return null;
  return {
    address: meta.address,
    amountRaw: meta.amountInRaw,
    tokenContract: meta.tokenContract ?? null,
    chainId: meta.chainId ?? null,
    chainSlug: meta.chainSlug ?? null,
    chainName: meta.chainName ?? null,
    decimals: meta.decimals,
    symbol: meta.symbol,
  };
}

function walletArt(src: string | undefined, name: string) {
  if (!src) {
    return (
      <span className="grid size-7 shrink-0 place-items-center text-accent-ink">
        <IconWallet size={20} stroke={1.8} aria-hidden />
      </span>
    );
  }
  if (src.startsWith("data:") || src.startsWith("http")) {
    return (
      // Wallet icons arrive from the wallet itself or from the catalogue.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden
        loading="eager"
        decoding="async"
        draggable={false}
        className="size-7 shrink-0 object-contain"
      />
    );
  }
  return <WalletIcon src={src} name={name} />;
}

function WalletCard({
  name,
  icon,
  connected = false,
  pending = false,
  disabled = false,
  onClick,
}: {
  name: string;
  icon?: string;
  connected?: boolean;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="flex h-auto w-full min-w-0 items-center justify-start gap-2.5 rounded-[8px] border border-line bg-page px-3.5 py-3 text-left text-[13px] font-medium leading-normal transition-colors duration-100 hover:border-line-strong hover:bg-hover disabled:opacity-60"
    >
      {walletArt(icon, name)}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {name}
        </span>
        {connected ? (
          <span className="mt-0.5 block text-[12px] leading-none text-green">
            Connected
          </span>
        ) : null}
      </span>
      {pending ? (
        <IconLoader2
          size={14}
          stroke={1.8}
          className="shrink-0 animate-spin text-ink-3"
        />
      ) : null}
    </Button>
  );
}

function Notice({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "error";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={`mt-3 rounded-[8px] px-3 py-2 text-[13px] leading-relaxed ${
        tone === "error" ? "bg-red-tint text-ink" : "bg-field text-ink-2"
      }`}
    >
      {children}
    </p>
  );
}

function isSolanaConnectedWallet(
  wallet: Wallet,
  connected: ConnectedWallet,
): boolean {
  if (wallet.accounts.some((account) => account.address === connected.address)) {
    return true;
  }
  if (!connected.walletName) return false;
  const name = connected.walletName.toLowerCase();
  return (
    wallet.name.toLowerCase().includes(name) ||
    name.includes(wallet.name.toLowerCase())
  );
}

export function FundWalletDialog({
  deposit,
  chainKind,
  connected,
  onClose,
  onUseQr,
  onFund,
  onSendConnected,
  depositReady,
}: FundWalletDialogProps) {
  const { solanaWallets } = useWallet();
  const eip6963 = useEip6963Providers();
  const details = useMemo(() => fundingDepositFor(deposit), [deposit]);

  const [chain, setChain] = useState<DepositWalletKind>(chainKind);
  const [state, setState] = useState<FundingState>("choosing");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [connection, setConnection] = useState<FundingConnection | null>(null);
  const [check, setCheck] = useState<FundingCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installLink, setInstallLink] = useState<string | null>(null);

  useEffect(() => {
    const cancel = scheduleWalletLogoPreload();
    return typeof cancel === "function" ? cancel : undefined;
  }, []);

  const amount = details
    ? `${formatRawAmount(BigInt(details.amountRaw), details.decimals)} ${details.symbol}`
    : null;
  const network =
    depositNetworkLabel(deposit) ??
    (chain === "evm" ? "EVM" : chain === "solana" ? "Solana" : "NEAR");
  const sending = state === "sending";

  const connectedInCatalog =
    (connected?.kind === "evm" &&
      !!connected.walletName &&
      EVM_CATALOG.some((entry) =>
        catalogEntryMatchesWallet(entry, connected.walletName),
      )) ||
    (connected?.kind === "solana" &&
      solanaWallets.some((wallet) =>
        isSolanaConnectedWallet(wallet, connected),
      ));
  const showConnectedCard =
    !!connected && connected.kind === chain && !connectedInCatalog;
  const wrongChain = chain !== chainKind;

  const resetToChoosing = () => {
    setState("choosing");
    setConnection(null);
    setCheck(null);
    setPendingKey(null);
    setError(null);
    setInstallLink(null);
  };

  const runCheck = async (next: FundingConnection, key: string) => {
    if (wrongChain) {
      setError(`This deposit is on ${network}. Choose a wallet on ${network} to fund it.`);
      setState("error");
      return;
    }
    if (!details) {
      setError("The deposit details are incomplete.");
      setState("error");
      return;
    }
    setPendingKey(key);
    setConnection(next);
    setError(null);
    setInstallLink(null);
    setState("checking");
    try {
      const result = await next.check(details);
      setCheck(result);
      setState(fundingStateForCheck(result));
    } catch (cause) {
      setError(friendlyFundingError(cause, details.chainName));
      setState("error");
    } finally {
      setPendingKey(null);
    }
  };

  const connectedFunding = (): FundingConnection => {
    if (!connected || !details) {
      throw new Error("This wallet is not connected.");
    }
    const send = onSendConnected;
    if (connected.kind === "evm") {
      return createConnectedEvmFunding({
        address: connected.address,
        deposit: details,
        send,
        walletName: connected.walletName,
        walletIcon: connected.walletIcon,
      });
    }
    if (connected.kind === "solana") {
      return createConnectedSolanaFunding({
        address: connected.address,
        send,
        walletName: connected.walletName,
        walletIcon: connected.walletIcon,
      });
    }
    return createConnectedNearFunding({
      address: connected.address,
      send,
    });
  };

  const chooseConnected = async () => {
    try {
      // Straight to the check: the wallet is already authorised, so asking
      // for accounts again would be a second connection prompt.
      await runCheck(connectedFunding(), "connected");
    } catch (cause) {
      setError(friendlyFundingError(cause, details?.chainName));
      setState("error");
    }
  };

  const chooseEvmCard = async (entry: SuggestEntry) => {
    if (!details) return;
    // Only an EIP-6963 provider is isolated. Falling back to the legacy
    // window.ethereum provider can be the same provider the app is connected
    // through; eth_requestAccounts there switches the active account and
    // makes the signed-in wallet look replaced.
    const announced = eip6963ProviderForEntry(entry, eip6963);
    const provider = announced?.provider as
      | Parameters<typeof connectEvmFunding>[0]["provider"]
      | null
      | undefined;
    if (!provider) {
      setError(`${entry.name} not detected.`);
      setInstallLink(entry.installUrl);
      setState("error");
      return;
    }
    setState("connecting");
    setPendingKey(`evm:${entry.id}`);
    setError(null);
    setInstallLink(null);
    try {
      const next = await connectEvmFunding({
        provider,
        deposit: details,
        walletName: entry.name,
        walletIcon: entry.icon,
      });
      await runCheck(next, `evm:${entry.id}`);
    } catch (cause) {
      setError(friendlyFundingError(cause, details.chainName));
      setState("error");
      setPendingKey(null);
    }
  };

  const chooseExtraEvm = async (detail: Eip6963Detail) => {
    if (!details) return;
    setState("connecting");
    setPendingKey(`evm:${detail.info.uuid}`);
    setError(null);
    setInstallLink(null);
    try {
      const next = await connectEvmFunding({
        provider: detail.provider as Parameters<
          typeof connectEvmFunding
        >[0]["provider"],
        deposit: details,
        walletName: detail.info.name,
        walletIcon: detail.info.icon,
      });
      await runCheck(next, `evm:${detail.info.uuid}`);
    } catch (cause) {
      setError(friendlyFundingError(cause, details.chainName));
      setState("error");
      setPendingKey(null);
    }
  };

  const chooseSolana = async (wallet: Wallet) => {
    if (!details) return;
    setState("connecting");
    setPendingKey(`sol:${wallet.name}`);
    setError(null);
    setInstallLink(null);
    try {
      const next = await connectSolanaFunding(wallet);
      await runCheck(next, `sol:${wallet.name}`);
    } catch (cause) {
      setError(friendlyFundingError(cause, details.chainName));
      setState("error");
      setPendingKey(null);
    }
  };

  const chooseNear = async () => {
    setState("connecting");
    setPendingKey("near");
    setError(null);
    setInstallLink(null);
    try {
      const next = await connectNearFunding();
      await runCheck(next, "near");
    } catch (cause) {
      setError(friendlyFundingError(cause, details?.chainName));
      setState("error");
      setPendingKey(null);
    }
  };

  const handleSwitch = async () => {
    if (!connection?.switchNetwork || !details) return;
    setState("checking");
    setPendingKey("switch");
    setError(null);
    try {
      await connection.switchNetwork();
      const result = await connection.check(details);
      setCheck(result);
      setState(fundingStateForCheck(result));
    } catch (cause) {
      setError(friendlyFundingError(cause, details.chainName));
      setState("error");
    } finally {
      setPendingKey(null);
    }
  };

  const handleSend = async () => {
    if (!connection || state !== "ready" || !depositReady) return;
    setState("sending");
    setError(null);
    try {
      await onFund(connection);
      onClose();
    } catch (cause) {
      setError(friendlyFundingError(cause, details?.chainName));
      setState("error");
    }
  };

  const handleTryAgain = async () => {
    if (!connection) {
      resetToChoosing();
      return;
    }
    await runCheck(connection, "retry");
  };

  const selected = connection ? (
    <div className="flex items-center gap-2.5 rounded-[8px] border border-line bg-page px-3.5 py-3">
      {walletArt(
        connection.walletIcon,
        connection.walletName ?? "Connected wallet",
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {connection.walletName ?? "Connected wallet"}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-2">
          {shortAddress(connection.address)}
        </span>
      </span>
      {state === "checking" || state === "sending" ? (
        <IconLoader2
          size={14}
          stroke={1.8}
          className="shrink-0 animate-spin text-ink-3"
        />
      ) : null}
    </div>
  ) : null;

  const statusText =
    state === "checking"
      ? "Checking this wallet’s balance and network…"
      : state === "connecting"
        ? "Approve connection in your wallet…"
        : state === "sending"
          ? "Sending the deposit…"
          : state === "wrong-network"
            ? `This wallet is on ${
                evmChainForId(check?.currentChainId ?? null)?.name ??
                (check?.currentChainId
                  ? `chain ${check.currentChainId}`
                  : "another network")
              }. Switch to ${network} to fund this deposit.`
            : state === "insufficient"
              ? (check?.shortfall ??
                "This wallet does not have enough for the deposit.")
              : state === "ready"
                ? depositReady
                  ? "The wallet has the amount and the gas for this deposit."
                  : "Checking the deposit address before sending…"
                : state === "error"
                  ? error
                  : null;
  const statusError = state === "error" || state === "insufficient";
  const footer = (
    <div className="flex flex-col gap-2">
      {statusText ? (
        <p
          role={statusError ? "alert" : undefined}
          className={`text-center text-[12.5px] leading-relaxed ${
            statusError ? "text-red" : "text-ink"
          }`}
        >
          {statusText}
          {state === "error" && installLink ? (
            <>
              {" "}
              <a
                href={installLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2 hover:opacity-80"
              >
                Install
                <IconExternalLink size={12} stroke={1.8} aria-hidden />
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-1.5">
        {fundingActionsForState(state, !!connection?.switchNetwork).map(
          (action) => {
            const onClick: Record<FundingAction, () => void> = {
              "Use QR": onUseQr,
              Switch: () => void handleSwitch(),
              "Try another": resetToChoosing,
              Send: () => void handleSend(),
              "Try again": () => void handleTryAgain(),
            };
            if (action === "Send" && !depositReady) return null;
            return (
              <Button
                key={action}
                type="button"
                variant={
                  action === "Use QR"
                    ? "ghost"
                    : action === "Try another"
                      ? "secondary"
                      : "accent"
                }
                size="sm"
                onClick={onClick[action]}
                disabled={action === "Switch" && pendingKey !== null}
              >
                {action}
              </Button>
            );
          },
        )}
      </div>
    </div>
  );

  const evmDetected = EVM_CATALOG.filter(
    (entry) => !!eip6963ProviderForEntry(entry, eip6963),
  );
  const connectedEvmEntry =
    connected?.kind === "evm"
      ? EVM_CATALOG.find((entry) =>
          catalogEntryMatchesWallet(entry, connected.walletName),
        ) ?? null
      : null;
  const evmOrdered = connectedEvmEntry
    ? [
        connectedEvmEntry,
        ...evmDetected.filter((entry) => entry.id !== connectedEvmEntry.id),
      ]
    : evmDetected;
  const evmSuggestions = EVM_CATALOG.filter(
    (entry) => !evmOrdered.some((shown) => shown.id === entry.id),
  );
  const evmExtra = eip6963.filter(
    (detail) =>
      !EVM_CATALOG.some(
        (entry) =>
          (entry.rdns &&
            detail.info.rdns.toLowerCase() === entry.rdns.toLowerCase()) ||
          detail.info.name.toLowerCase().includes(entry.match),
      ) &&
      !(
        connected?.kind === "evm" &&
        connected.walletName &&
        detail.info.name.toLowerCase().includes(connected.walletName.toLowerCase())
      ),
  );

  const solanaOrdered =
    connected?.kind === "solana"
      ? [
          ...solanaWallets.filter((wallet) =>
            isSolanaConnectedWallet(wallet, connected),
          ),
          ...solanaWallets.filter(
            (wallet) => !isSolanaConnectedWallet(wallet, connected),
          ),
        ]
      : solanaWallets;
  const solanaSuggestions = SOL_CATALOG.filter(
    (entry) =>
      !solanaWallets.some((wallet) =>
        wallet.name.toLowerCase().includes(entry.match),
      ),
  );

  return (
    <WalletPickerDialog
      label="Fund this deposit"
      title="Fund from wallet"
      icon={
        <IconWallet
          size={14}
          stroke={2}
          className="shrink-0 text-ink-2"
          aria-hidden
        />
      }
      subtitle={amount ? `${amount} on ${network}` : undefined}
      onClose={onClose}
      busy={sending}
      contentKey={`${state}:${chain}`}
      footer={footer}
    >
      <div data-funding-state={state}>
        {state === "choosing" || state === "connecting" ? (
          <>
            <div className="flex max-h-[420px] min-h-[264px] overflow-hidden">
              <div className="w-[124px] shrink-0 border-r border-line p-1.5 sm:w-[148px]">
                {CHAINS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={state === "connecting"}
                    onClick={() => {
                      setChain(item.id);
                      resetToChoosing();
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-3 text-left text-[13px] font-medium transition-colors duration-100 disabled:opacity-60 ${
                      chain === item.id
                        ? "bg-hover-2 text-ink"
                        : "text-ink-2 hover:bg-hover hover:text-ink"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.icon}
                      alt=""
                      aria-hidden
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      draggable={false}
                      className="size-6 shrink-0 object-contain"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1.5">
                {wrongChain ? (
                  <Notice>
                    This deposit is on {network}. Choose a wallet on {network}{" "}
                    to fund it.
                  </Notice>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {showConnectedCard && connected ? (
                    <WalletCard
                      name={
                        connected.walletName ?? shortAddress(connected.address)
                      }
                      icon={connected.walletIcon}
                      connected
                      pending={pendingKey === "connected"}
                      disabled={state === "connecting"}
                      onClick={() => void chooseConnected()}
                    />
                  ) : null}

                  {chain === "evm" ? (
                    <>
                      {evmOrdered.map((entry) => {
                        const key = `evm:${entry.id}`;
                        const isConnected =
                          connected?.kind === "evm" &&
                          connectedEvmEntry?.id === entry.id;
                        return (
                          <WalletCard
                            key={entry.id}
                            name={entry.name}
                            icon={entry.icon}
                            connected={isConnected}
                            pending={
                              pendingKey === (isConnected ? "connected" : key)
                            }
                            disabled={state === "connecting"}
                            onClick={() => {
                              if (isConnected) void chooseConnected();
                              else void chooseEvmCard(entry);
                            }}
                          />
                        );
                      })}
                      {evmSuggestions.map((entry) => (
                        <WalletCard
                          key={entry.id}
                          name={entry.name}
                          icon={entry.icon}
                          disabled={state === "connecting"}
                          onClick={() => {
                            setError(`${entry.name} not detected.`);
                            setInstallLink(entry.installUrl);
                            setState("error");
                          }}
                        />
                      ))}
                      {evmExtra.map((detail) => (
                        <WalletCard
                          key={detail.info.uuid}
                          name={detail.info.name}
                          icon={detail.info.icon}
                          pending={pendingKey === `evm:${detail.info.uuid}`}
                          disabled={state === "connecting"}
                          onClick={() => void chooseExtraEvm(detail)}
                        />
                      ))}
                    </>
                  ) : chain === "solana" ? (
                    <>
                      {solanaOrdered.map((wallet) => {
                        const isConnected =
                          connected?.kind === "solana" &&
                          isSolanaConnectedWallet(wallet, connected);
                        return (
                          <WalletCard
                            key={wallet.name}
                            name={wallet.name}
                            icon={wallet.icon}
                            connected={isConnected}
                            pending={
                              pendingKey ===
                              (isConnected ? "connected" : `sol:${wallet.name}`)
                            }
                            disabled={state === "connecting"}
                            onClick={() => {
                              if (isConnected) void chooseConnected();
                              else void chooseSolana(wallet);
                            }}
                          />
                        );
                      })}
                      {solanaSuggestions.map((entry) => (
                        <WalletCard
                          key={entry.id}
                          name={entry.name}
                          icon={entry.icon}
                          disabled={state === "connecting"}
                          onClick={() => {
                            setError(`${entry.name} not detected.`);
                            setInstallLink(entry.installUrl);
                            setState("error");
                          }}
                        />
                      ))}
                    </>
                  ) : (
                    <WalletCard
                      name="NEAR wallet"
                      pending={pendingKey === "near"}
                      disabled={state === "connecting"}
                      onClick={() => void chooseNear()}
                    />
                  )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="p-4">
            {selected}
            {state === "wrong-network" && !connection?.switchNetwork ? (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                Use another wallet, or send the amount to the address.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </WalletPickerDialog>
  );
}
