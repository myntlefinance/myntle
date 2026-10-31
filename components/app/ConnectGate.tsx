"use client";

import { useEffect, useState } from "react";
import { IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";

/**
 * The wallet gate.
 *
 * Shown as the assistant's reply when a visitor without a wallet tries to
 * send. It reuses the live reply's wrapper and the thinking loader, so the
 * gated turn reads as a simulated round trip rather than an error state.
 */

export const OPEN_WALLET_EVENT = "myntle:open-wallet";

export function openWalletPicker() {
  window.dispatchEvent(new CustomEvent(OPEN_WALLET_EVENT));
}

export function ConnectGate() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return (
      <div
        className="flex min-h-6 items-center"
        style={{ animation: "fade-in 200ms ease-out both" }}
      >
        <LoadingState label="Thinking" variant="Dots" />
      </div>
    );
  }

  return (
    <article
      className="min-w-0"
      style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <div className="max-w-[620px] text-[14px] leading-[1.6] text-ink">
        <p>You are currently not logged in.</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={openWalletPicker}
            className="inline-flex shrink-0"
          >
            <IconWallet size={13} stroke={1.8} className="shrink-0" />
            Connect Wallet
          </Button>
          <span>to start a chat with myntle.</span>
        </p>
      </div>
    </article>
  );
}
