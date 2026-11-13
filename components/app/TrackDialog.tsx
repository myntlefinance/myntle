"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconEye, IconLoader2, IconX } from "@tabler/icons-react";
import { WalletPickerDialog } from "@/components/app/WalletPickerDialog";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import { Button } from "@/components/atoms/Button";
import { truncateTechData } from "@/components/atoms/TechDataChip";
import NetworkIcon from "@/components/finance/NetworkIcon";
import {
  MAX_WATCH_LABEL_LENGTH,
  isEnsNameInput,
  isSnsNameInput,
  normalizeWatchedAddress,
  watchAddressError,
  watchNameError,
  type WatchChain,
  type WatchInputResolution,
} from "@/lib/wallet/addresses";
import type { WatchlistEntry } from "./useWatchlist";

/* ─────────────────────────────────────────────────────────
 * TRACK DIALOG
 * The watch-address dialog on the wallet picker's frame: the header
 * bar with its close control, the icon-led chain switch, and a
 * labeled field per question. The address validates per chain before
 * Track enables, and every height change replays the picker's own
 * transition instead of jumping. The primary action is the accent
 * blue, like every other dialog that asks for a decision.
 * ───────────────────────────────────────────────────────── */

export type ChainTab = "EVM" | "Solana" | "Near";

export const CHAIN_TABS: readonly ChainTab[] = [
  "EVM",
  "Solana",
  "Near",
] as const;

/* The EVM field takes a domain name as well as an address, and so does
 * the Solana field; a name reads through the resolve route on a debounce
 * while the dialog shows where the read stands. */
const PLACEHOLDERS: Record<ChainTab, string> = {
  EVM: "EVM address or domain name",
  Solana: "Solana address or domain name",
  Near: "NEAR account",
};

const CHAIN_ICON_NETWORK: Record<ChainTab, string> = {
  EVM: "ethereum",
  Solana: "solana",
  Near: "near",
};

function ChainTabIcon({ tab }: { tab: ChainTab }) {
  return <NetworkIcon network={CHAIN_ICON_NETWORK[tab]} size={14} />;
}

const CHAIN_TAB_ICONS: Record<ChainTab, ReactNode> = {
  EVM: <ChainTabIcon tab="EVM" />,
  Solana: <ChainTabIcon tab="Solana" />,
  Near: <ChainTabIcon tab="Near" />,
};

export function toWatchChain(tab: ChainTab): WatchChain {
  if (tab === "EVM") return "evm";
  if (tab === "Solana") return "solana";
  return "near";
}

/** The pause after the last keystroke before a name read starts. */
const RESOLVE_DEBOUNCE_MS = 350;

/**
 * Previews one name input against the resolve route. Never throws: every
 * failure reads as its status, so the dialog always has a line to show.
 * The preview only gates the dialog — the server resolves again at submit
 * time and never trusts the address returned here.
 */
export async function previewWatchName(
  input: string,
  chain: "evm" | "solana" = "evm",
): Promise<WatchInputResolution> {
  let res: Response;
  try {
    res = await fetch(
      `/api/names/resolve?chain=${chain}&name=${encodeURIComponent(input.trim())}`,
      { cache: "no-store" },
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (res.status === 404) return { ok: false, reason: "unregistered" };
  if (res.status === 400) return { ok: false, reason: "invalid" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const body = (await res.json().catch(() => null)) as {
    address?: unknown;
    name?: unknown;
    resolvedAt?: unknown;
  } | null;
  if (
    !body ||
    typeof body.address !== "string" ||
    typeof body.name !== "string" ||
    typeof body.resolvedAt !== "string"
  ) {
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    address: body.address,
    name: body.name,
    resolvedAt: body.resolvedAt,
  };
}

const CHAIN_TABS_BY_CHAIN: Record<WatchChain, ChainTab> = {
  evm: "EVM",
  solana: "Solana",
  near: "Near",
};

/** The dialog's three questions, with the address validated per chain.
 * An initial value prefills the form for editing. */
export function useTrackForm(initial?: {
  tab: ChainTab;
  address: string;
  label: string;
}) {
  const [tab, setTab] = useState<ChainTab>(initial?.tab ?? "EVM");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const chain = toWatchChain(tab);
  const normalized = normalizeWatchedAddress(chain, address);
  // A name input on the EVM (`.eth`) or Solana (`.sns`) tab reads as a
  // name, never as a malformed address: the sync path below stays for raw
  // input only.
  const isName =
    isEnsNameInput(chain, address) || isSnsNameInput(chain, address);
  const [nameRead, setNameRead] = useState<WatchInputResolution | null>(null);
  const [resolving, setResolving] = useState(false);

  // The debounced preview: one resolve-route read settles after the user
  // pauses, and a newer keystroke abandons the in-flight one. The preview
  // only gates the dialog; the server resolves again at submit time and
  // never trusts the address shown here.
  /* eslint-disable react-hooks/set-state-in-effect -- debounce sync: a new
   * input clears the previous preview and raises the resolving flag */
  useEffect(() => {
    if (!isName) {
      setNameRead(null);
      setResolving(false);
      return;
    }
    setNameRead(null);
    setResolving(true);
    let live = true;
    // The preview only runs while the input is a name, so the chain here
    // is always one the resolve route reads: Solana stays Solana, and the
    // EVM tab stays EVM.
    const previewChain = chain === "solana" ? "solana" : "evm";
    const timer = window.setTimeout(() => {
      void previewWatchName(address, previewChain).then((read) => {
        if (!live) return;
        setNameRead(read);
        setResolving(false);
      });
    }, RESOLVE_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [chain, address, isName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const error = isName
    ? nameRead && !nameRead.ok
      ? watchNameError(nameRead.reason)
      : null
    : watchAddressError(chain, address);
  const resolvedAddress =
    isName && nameRead?.ok ? nameRead.address : null;
  const resolvedName = isName && nameRead?.ok ? nameRead.name : null;
  return {
    tab,
    setTab,
    address,
    setAddress,
    label,
    setLabel,
    chain,
    normalized,
    error,
    /** True while the input is a name rather than a raw address. */
    isName,
    /** True while the debounced name read is still on its way. */
    resolving,
    /** The previewed address once the name read lands, else null. */
    resolvedAddress,
    /** The normalized name once the read lands, else null. */
    resolvedName,
    ready: isName ? resolvedAddress !== null : normalized !== null,
    reset() {
      setTab(initial?.tab ?? "EVM");
      setAddress(initial?.address ?? "");
      setLabel(initial?.label ?? "");
      setNameRead(null);
      setResolving(false);
    },
  };
}

export type TrackForm = ReturnType<typeof useTrackForm>;

export function TrackAddressFields({
  form,
  onSubmit,
}: {
  form: TrackForm;
  onSubmit: () => void;
}) {
  // The name read's standing, in the muted voice: what is being read while
  // it is on its way, and the resolved address once it lands. The address
  // is the number the user is deciding on, so it earns its place here.
  const nameStatus =
    form.isName && (form.resolving || form.resolvedAddress)
      ? form.resolving
        ? "Resolving the name."
        : `Resolves to ${truncateTechData(form.resolvedAddress ?? "", form.chain)}.`
      : null;
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        options={CHAIN_TABS}
        value={form.tab}
        onChange={form.setTab}
        icons={CHAIN_TAB_ICONS}
        className="self-start"
      />
      {/* The label reads above its field, never inside it; the muted
        marker keeps the optional state out of the name itself. */}
      <div>
        <label
          htmlFor="track-label"
          className="mb-1.5 block text-[13px] font-medium text-ink"
        >
          Label <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <div className="flex h-10 items-center overflow-hidden rounded-[8px] bg-field px-3 shadow-hairline">
          <input
            id="track-label"
            value={form.label}
            onChange={(e) => form.setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
            placeholder="Enter a label for the address"
            aria-label="Label (optional)"
            maxLength={MAX_WATCH_LABEL_LENGTH}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
          />
        </div>
      </div>
      {/* The address carries its chain mark instead of a search glyph.
        A validation error grows the dialog through the picker's own
        grid rhythm instead of jumping it. */}
      <div>
        <label
          htmlFor="track-address"
          className="mb-1.5 block text-[13px] font-medium text-ink"
        >
          Address
        </label>
        <div className="flex h-10 items-center overflow-hidden rounded-[8px] bg-field px-3 text-ink-3 shadow-hairline focus-within:text-ink-2">
          <span className="flex shrink-0 items-center justify-center">
            <NetworkIcon network={CHAIN_ICON_NETWORK[form.tab]} size={15} />
          </span>
          <input
            id="track-address"
            value={form.address}
            onChange={(e) => form.setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
            placeholder={PLACEHOLDERS[form.tab]}
            aria-label="Address"
            spellCheck={false}
            autoComplete="off"
            className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
          />
          {form.address ? (
            <button
              type="button"
              aria-label="Clear address"
              onClick={() => form.setAddress("")}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-3 transition-[background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
            >
              <IconX size={14} aria-hidden />
            </button>
          ) : null}
        </div>
        <div
          className="grid"
          style={{
            gridTemplateRows: nameStatus ? "1fr" : "0fr",
            transition: "grid-template-rows 240ms var(--ease-out-strong)",
          }}
        >
          <div className="min-h-0 overflow-hidden">
            {nameStatus ? (
              <p
                role="status"
                className="flex items-center gap-1.5 pt-1.5 text-[12.5px] leading-relaxed text-ink-2"
                style={{ animation: "fade-in 180ms ease-out both" }}
              >
                {form.resolving ? (
                  <IconLoader2
                    size={12}
                    aria-hidden
                    className="animate-spin"
                  />
                ) : null}
                {nameStatus}
              </p>
            ) : null}
          </div>
        </div>
        <div
          className="grid"
          style={{
            gridTemplateRows: form.error ? "1fr" : "0fr",
            transition: "grid-template-rows 240ms var(--ease-out-strong)",
          }}
        >
          <div className="min-h-0 overflow-hidden">
            {form.error ? (
              <p
                role="alert"
                className="pt-1.5 text-[12.5px] leading-relaxed text-red"
                style={{ animation: "fade-in 180ms ease-out both" }}
              >
                {form.error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrackDialog({
  open,
  title = "Track address",
  submitLabel = "Track",
  initial,
  onClose,
  onTrack,
  origin,
  failureMessage = "The address could not be tracked.",
  atLimit = false,
}: {
  open: boolean;
  /** Edit mode renames the chrome; the fields stay the same. */
  title?: string;
  submitLabel?: string;
  /** Prefills the form for editing. The address may change as well. */
  initial?: {
    chain: WatchChain;
    address: string;
    label: string | null;
  };
  failureMessage?: string;
  onClose: () => void;
  onTrack: (input: {
    chain: WatchChain;
    address: string;
    label?: string;
  }) => Promise<WatchlistEntry>;
  /** Viewport point the dialog grows from; clamped to its own edge. */
  origin?: { x: number; y: number } | null;
  /** Five addresses at most: tracking disables with a reason when full. */
  atLimit?: boolean;
}) {
  const form = useTrackForm(
    initial
      ? {
          tab: CHAIN_TABS_BY_CHAIN[initial.chain],
          address: initial.address,
          label: initial.label ?? "",
        }
      : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // A submitted dialog reopens empty: the next address starts blank.
  /* eslint-disable react-hooks/set-state-in-effect -- mount-once reset per open */
  useEffect(() => {
    if (open) {
      form.reset();
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!open) return null;

  const submit = () => {
    if (!form.ready || busy || atLimit) return;
    // A name travels as typed: the server resolves it again itself and
    // never trusts the previewed address. A raw address travels
    // normalized, exactly as before.
    const address = form.isName ? form.address.trim() : form.normalized;
    if (!address) return;
    const chain = form.chain;
    const name = form.label.trim();
    setBusy(true);
    setSubmitError(null);
    void onTrack({
      chain,
      address,
      ...(name ? { label: name } : {}),
    })
      .then(() => onClose())
      .catch((cause: unknown) => {
        setSubmitError(
          cause instanceof Error ? cause.message : failureMessage,
        );
      })
      .finally(() => setBusy(false));
  };

  // The tab and the limit note are the only structural states, and both
  // are fixed while editing: switching chains only swaps the icon and
  // the hint, and every notice (validation, resolving, submit failure)
  // grows through its own grid rhythm. So the key stays put while typing
  // and the picker's height measure never chases a mid-transition grid,
  // which is what slid and clipped the error as the input grew.
  const contentKey = atLimit ? "full" : "room";

  return (
    <WalletPickerDialog
      label={title}
      title={title}
      icon={<IconEye size={14} stroke={2} className="shrink-0" aria-hidden />}
      onClose={onClose}
      busy={busy}
      contentKey={contentKey}
      origin={origin}
      footer={
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={submit}
            disabled={!form.ready || busy || atLimit}
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <IconLoader2 size={14} stroke={2} className="animate-spin" />
                {submitLabel}
              </span>
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      }
    >
      <div className="px-4 py-3">
        {atLimit ? (
          <p
            role="note"
            className="mb-3 rounded-[8px] bg-inset px-3 py-2 text-[13px] leading-relaxed text-ink-2"
          >
            You can track up to 5 addresses. Remove one to track another.
          </p>
        ) : null}
        <TrackAddressFields form={form} onSubmit={submit} />
        {/* The submit failure grows the dialog through the same grid
          rhythm as the sign-in notice, instead of jumping it. */}
        <div
          className="grid"
          style={{
            gridTemplateRows: submitError ? "1fr" : "0fr",
            transition: "grid-template-rows 240ms var(--ease-out-strong)",
          }}
        >
          <div className="min-h-0 overflow-hidden">
            {submitError ? (
              <p
                key={submitError}
                role="alert"
                className="mt-3 rounded-[8px] bg-red-tint px-3 py-2 text-[13px] text-ink"
                style={{ animation: "fade-in 180ms ease-out both" }}
              >
                {submitError}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </WalletPickerDialog>
  );
}
