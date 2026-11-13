"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconQrcode,
  IconWallet,
} from "@tabler/icons-react";
import { Button, buttonVariants } from "@/components/atoms/Button";
import { DialogShell } from "@/components/app/DialogShell";
import { DepositQr } from "@/components/finance/DepositQr";
import { addressExplorerUrl } from "@/lib/wallet/explorer";
import type { ChainKind } from "@/lib/wallet/types";

/* ─────────────────────────────────────────────────────────
 * ADDRESS QR DIALOG
 * The address as a locally generated QR code, for scanning from
 * another device instead of copying the address over. The pattern
 * is built in the browser like the deposit QR — no QR service ever
 * sees the address. The actions below it use the product's button
 * primitives, side by side: copy here, or open the chain's explorer.
 * ───────────────────────────────────────────────────────── */

/* The wallet menu's copy behavior, in the button's own style: the old
 * glyph and label blur and shrink away while the green pair resolves in.
 * Both labels share one grid cell, so the pill keeps its width. */
const COPY_CROSSFADE =
  "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)";

function CopyAddressAction({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(address);
        setCopied(true);
      } catch {
        // Clipboard unavailable; the address stays selectable above.
      }
    })();
  };

  const icon = (on: boolean) => ({
    opacity: on ? 1 : 0,
    filter: on ? "blur(0px)" : "blur(2.5px)",
    transform: on ? "scale(1)" : "scale(0.85)",
    transition: COPY_CROSSFADE,
    willChange: "transform, opacity, filter",
  });
  const label = (on: boolean) => ({
    opacity: on ? 1 : 0,
    filter: on ? "blur(0px)" : "blur(2px)",
    transition: COPY_CROSSFADE,
    willChange: "opacity, filter",
  });

  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy}>
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
          style={icon(!copied)}
        >
          <IconCopy size={14} stroke={1.8} />
        </span>
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-green"
          style={icon(copied)}
        >
          <IconCheck size={14} stroke={2.4} />
        </span>
      </span>
      <span className="grid overflow-hidden">
        <span
          aria-hidden={copied}
          className="col-start-1 row-start-1"
          style={label(!copied)}
        >
          Copy address
        </span>
        <span
          aria-hidden={!copied}
          className="col-start-1 row-start-1 font-medium text-green"
          style={label(copied)}
        >
          Copied
        </span>
      </span>
    </Button>
  );
}

function AddressActions({
  address,
  chain,
}: {
  address: string;
  chain: ChainKind;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <CopyAddressAction address={address} />
      <a
        href={addressExplorerUrl(chain, address)}
        target="_blank"
        rel="noreferrer noopener"
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        <IconExternalLink size={14} stroke={1.8} aria-hidden />
        View on explorer
      </a>
    </div>
  );
}

export function AddressQrDialog({
  address,
  title,
  chain,
  onClose,
}: {
  address: string;
  title: string;
  chain: ChainKind;
  onClose: () => void;
}) {
  const value = address.trim();
  return (
    <DialogShell
      label={title}
      title={title}
      icon={<IconWallet size={14} stroke={2} className="shrink-0" aria-hidden />}
      closeButton
      onClose={onClose}
    >
      <div className="flex flex-col items-stretch gap-5 pt-3">
        <div className="flex justify-center">
          <DepositQr value={value} />
        </div>
        <p className="w-full text-center text-[13px] font-semibold leading-relaxed break-all text-ink">
          {value}
        </p>
        <AddressActions address={value} chain={chain} />
        <p
          role="note"
          className="flex items-start gap-2 rounded-[8px] bg-orange-tint px-3 py-2 text-[12.5px] leading-relaxed text-ink-2"
        >
          {/* Center the mark on the first line, not on the whole wrapped
            * paragraph: the note is two lines on most widths. */}
          <span className="flex h-[20px] shrink-0 items-center">
            <IconAlertTriangle
              size={14}
              stroke={2}
              className="text-attention"
              aria-hidden
            />
          </span>
          <span>
            Only send tokens supported by this address. Tokens sent on an
            unsupported network or contract cannot be recovered.
          </span>
        </p>
      </div>
    </DialogShell>
  );
}

/* The address row's far-edge action: the deposit address as a QR,
 * named for what the user is doing rather than for the control that
 * opens it. */
export function DepositButton({
  address,
  title,
  chain,
  label = "Deposit",
}: {
  address: string;
  title: string;
  chain: ChainKind;
  /** Watched accounts move funds to someone else's address: Transfer. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="xs"
        onClick={() => setOpen(true)}
        className="shrink-0"
      >
        <IconQrcode size={14} stroke={1.8} aria-hidden />
        {label}
      </Button>
      {open ? (
        <AddressQrDialog
          address={address}
          title={title}
          chain={chain}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export default AddressQrDialog;
