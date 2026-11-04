"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";
import { useAuth } from "@/lib/auth/auth-provider";
import { openSignIn } from "@/components/app/SignInDialog";

/**
 * The wallet gate.
 *
 * Shown as the assistant's reply when a visitor without a session tries to
 * send. It reuses the live reply's wrapper and the thinking loader, so the
 * gated turn reads as a simulated round trip rather than an error state.
 */

export const OPEN_WALLET_EVENT = "myntle:open-wallet";

export function openWalletPicker() {
  window.dispatchEvent(new CustomEvent(OPEN_WALLET_EVENT));
}

export function ConnectGate() {
  const [ready, setReady] = useState(false);
  const { connected, signedIn, status } = useAuth();

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(t);
  }, []);

  // The session check answers before the gate does, so the button below is
  // never the wrong one for a moment.
  if (!ready || status === "unknown") {
    return (
      <div
        className="flex min-h-6 items-center"
        style={{ animation: "fade-in 200ms ease-out both" }}
      >
        <LoadingState label="Thinking" variant="Dots" />
      </div>
    );
  }

  // A connected wallet without a session is unsigned: the gate offers the
  // signature, not another connection. Cancelling that signature leaves
  // this gate exactly where it was.
  const unsigned = connected && !signedIn;

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
            onClick={unsigned ? openSignIn : openWalletPicker}
            className="inline-flex shrink-0"
          >
            {unsigned ? "Sign In" : "Log In"}
          </Button>
          <span>to start a chat with myntle.</span>
        </p>
      </div>
    </article>
  );
}
