"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconLoader2,
  IconLockFilled,
  IconLockOpen,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { DialogShell } from "@/components/app/DialogShell";
import { useWallet } from "@/lib/wallet/registry";
import {
  confirmNearSetup,
  fetchNearSetup,
  fundNearSetup,
  type NearSetupState,
} from "@/lib/intents/near-setup";
import {
  notifySuperClosed,
  SUPER_CANCEL_EVENT,
} from "@/lib/intents/user-session";

type Phase =
  | "checking"
  | "sending"
  | "ready"
  | "registering"
  | "confirming"
  | "done"
  | "error";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * The one-time NEAR setup dialog.
 *
 * A named NEAR account cannot authenticate until its wallet key is registered
 * on `intents.near`. Myntle sends the tiny network fee first, then the wallet
 * approves one `add_public_key` transaction. The grant is stored server-side
 * per account and key, so a dismissed dialog or a spent balance never causes
 * a second transfer.
 */
export function NearSetupDialog({
  onClose,
  onDone,
  sourceCallId,
}: {
  onClose: () => void;
  /** Fires after the registration is confirmed on chain, or when no setup is needed. */
  onDone: () => void;
  sourceCallId?: string | null;
}) {
  const { getNearPublicKey, registerNearIntentsKey } = useWallet();
  const [phase, setPhase] = useState<Phase>("checking");
  const [state, setState] = useState<NearSetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [confirmOnly, setConfirmOnly] = useState(false);

  const closeRef = useRef(onClose);
  const doneRef = useRef(onDone);
  const aliveRef = useRef(true);
  const runRef = useRef<() => Promise<void>>(async () => {});
  // The wallet context returns a fresh function each render. Keep the latest
  // one in a ref so the setup check does not restart on every provider update.
  const getKeyRef = useRef(getNearPublicKey);
  const registerRef = useRef(registerNearIntentsKey);

  useEffect(() => {
    closeRef.current = onClose;
    doneRef.current = onDone;
  }, [onClose, onDone]);

  useEffect(() => {
    getKeyRef.current = getNearPublicKey;
    registerRef.current = registerNearIntentsKey;
  }, [getNearPublicKey, registerNearIntentsKey]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== "done") return;
    const fade = window.setTimeout(() => setLeaving(true), 850);
    const finish = window.setTimeout(() => {
      notifySuperClosed();
      doneRef.current();
    }, 1100);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(finish);
    };
  }, [phase]);

  const fail = useCallback((message: string) => {
    if (!aliveRef.current) return;
    setError(message);
    setPhase("error");
  }, []);

  const pollGrant = useCallback(
    async (publicKey: string | null) => {
      for (let i = 0; i < 20; i += 1) {
        await sleep(1500);
        if (!aliveRef.current) return;
        const next = await fetchNearSetup(publicKey);
        if (!aliveRef.current) return;
        if (!next) continue;
        setState(next);
        if (next.grant?.status === "final") {
          setPhase("ready");
          return;
        }
        if (next.grant?.status === "failed") {
          setPhase("ready");
          return;
        }
      }
      if (aliveRef.current) setPhase("ready");
    },
    [],
  );

  const sendFee = useCallback(
    async (publicKey: string | null) => {
      if (!aliveRef.current) return;
      setError(null);
      setPhase("sending");
      const next = await fundNearSetup(publicKey);
      if (!aliveRef.current) return;
      if (!next) {
        // The request may have timed out after the grant row was written.
        // Read the durable state before telling the user it failed.
        const recovered = await fetchNearSetup(publicKey);
        if (!aliveRef.current) return;
        if (recovered?.grant) {
          setState(recovered);
          if (recovered.grant.status === "final") {
            setPhase("ready");
            return;
          }
          if (
            recovered.grant.status === "pending" ||
            recovered.grant.status === "sent"
          ) {
            setPhase("sending");
            void pollGrant(publicKey);
            return;
          }
          setPhase("ready");
          return;
        }
        fail("NEAR setup is unavailable right now. Try again later.");
        return;
      }
      setState(next);
      if (next.grant?.status === "failed") {
        setPhase("ready");
        return;
      }
      if (next.grant?.status === "final") {
        setPhase("ready");
        return;
      }
      void pollGrant(publicKey);
    },
    [fail, pollGrant],
  );

  const load = useCallback(async () => {
    // Defer the first state write out of the effect body; the check itself is
    // asynchronous anyway.
    await Promise.resolve();
    if (!aliveRef.current) return;
    setConfirmOnly(false);
    setError(null);
    setPhase("checking");
    let key: string | null = null;
    try {
      key = (await getKeyRef.current())?.trim() || null;
    } catch {
      key = null;
    }
    const next = await fetchNearSetup(key);
    if (!aliveRef.current) return;
    if (!next) {
      fail("NEAR setup is unavailable right now. Try again later.");
      return;
    }
    setState(next);

    if (!next.needsSetup) {
      // The key was registered elsewhere or the account is implicit.
      notifySuperClosed();
      doneRef.current();
      return;
    }
    if (next.needsKey) {
      setPhase("error");
      return;
    }
    if (next.badKey) {
      setPhase("error");
      return;
    }
    if (next.needsFunding) {
      void sendFee(next.publicKey ?? key);
      return;
    }
    if (
      next.grant?.status === "pending" ||
      next.grant?.status === "sent"
    ) {
      setPhase("sending");
      void pollGrant(next.publicKey ?? key);
      return;
    }
    setPhase("ready");
  }, [fail, pollGrant, sendFee]);

  useEffect(() => {
    runRef.current = load;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleRegister = useCallback(async () => {
    if (!state?.publicKey) return;
    setConfirmOnly(false);
    setError(null);
    setPhase("registering");
    try {
      await registerRef.current(state.publicKey);
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "";
      fail(
        /reject|cancel|denied|dismiss/i.test(raw)
          ? "Registration cancelled. You can try again."
          : "The registration did not go through. Try again.",
      );
      setPhase("ready");
      return;
    }
    if (!aliveRef.current) return;
    setConfirmOnly(true);
    setPhase("confirming");

    for (let i = 0; i < 8; i += 1) {
      const confirmed = await confirmNearSetup(state.publicKey);
      if (!aliveRef.current) return;
      if (confirmed?.ok) {
        setPhase("done");
        return;
      }
      await sleep(900);
    }

    fail(
      "The registration is still confirming. Reopen this dialog in a moment.",
    );
  }, [fail, state]);

  const closeWithoutSetup = () => {
    if (sourceCallId) {
      window.dispatchEvent(
        new CustomEvent(SUPER_CANCEL_EVENT, {
          detail: { callId: sourceCallId },
        }),
      );
    }
    notifySuperClosed();
    closeRef.current();
  };

  const grantReady =
    state?.grant?.status === "final" || state?.grant?.status === "registered";
  const canRegister =
    Boolean(state?.publicKey) && state?.hasGas === true;
  const busy =
    phase === "checking" ||
    phase === "sending" ||
    phase === "registering" ||
    phase === "confirming";

  const amount = state?.amountNear ?? "0.0015";
  const grantFailed = state?.grant?.status === "failed";
  const grantSpent = grantReady && state?.hasGas !== true;
  const needsIdentity = Boolean(state?.needsKey || state?.badKey);

  const title =
    phase === "done"
      ? "Super account ready"
      : "Set up your super account";

  const subtitle =
    phase === "done"
      ? "Your super account is ready."
      : state?.needsKey
        ? "Sign in again so Myntle can use this wallet's key."
        : state?.badKey
          ? "This wallet key no longer belongs to the account. Reconnect and sign in again."
          : grantFailed && state?.hasGas !== true
            ? "NEAR Intents needs to register this wallet's key once before your super account can open. The network fee could not be sent, so add a little NEAR to this account and try again."
            : grantSpent
              ? "The network fee was sent earlier, but this account no longer has enough NEAR. Add a little NEAR and try again."
              : grantReady
                ? "NEAR Intents needs to register this wallet's key once before your super account can open. Approve one registration to finish."
                : state?.hasGas
                  ? "NEAR Intents needs to register this wallet's key once before your super account can open. This is a network transaction, and only the fee is spent."
                  : `NEAR Intents needs to register this wallet's key once before your super account can open. We send ${amount} NEAR to cover the network fee, then you approve one registration.`;

  const status =
    phase === "checking"
      ? { spinner: true, text: "Checking your NEAR account…" }
      : phase === "sending"
        ? { spinner: true, text: `Sending ${amount} NEAR for the network fee…` }
        : phase === "registering"
          ? { spinner: true, text: "Approve the registration in your wallet…" }
          : phase === "confirming"
            ? { spinner: true, text: "Confirming the registration…" }
            : grantReady && !grantSpent && phase !== "done" && !error
              ? { spinner: false, text: `We sent ${amount} NEAR for the network fee.` }
              : null;

  const action =
    phase === "done" ? null : busy ? (
      <Button type="button" variant="accent" size="sm" disabled>
        <span className="inline-flex items-center gap-1.5">
          <IconLoader2 size={14} stroke={2} className="animate-spin" />
          {phase === "sending"
            ? "Sending"
            : phase === "registering"
              ? "Waiting"
              : "Checking"}
        </span>
      </Button>
    ) : needsIdentity ? null : phase === "error" && confirmOnly ? (
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={() => void runRef.current()}
      >
        Check again
      </Button>
    ) : !canRegister ? (
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={() => void runRef.current()}
      >
        Try again
      </Button>
    ) : (
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={() => void handleRegister()}
      >
        Register key
      </Button>
    );

  return (
    <DialogShell
      label={title}
      title={title}
      icon={
        phase === "done" ? (
          <IconLockOpen
            size={14}
            stroke={2}
            className="shrink-0 text-green"
            aria-hidden
          />
        ) : (
          <IconLockFilled
            size={14}
            className="shrink-0 text-attention"
            aria-hidden
          />
        )
      }
      subtitle={subtitle}
      onClose={closeWithoutSetup}
      busy={busy || phase === "done"}
      leaving={leaving}
      footer={
        phase === "done" ? undefined : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeWithoutSetup}
              disabled={busy}
            >
              Cancel
            </Button>
            {action}
          </>
        )
      }
    >
      <div
        className="grid"
        style={{
          gridTemplateRows: status || error ? "1fr" : "0fr",
          transition: "grid-template-rows 240ms var(--ease-out-strong)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          {status ? (
            <p
              key={status.text}
              className="mt-3 flex items-center gap-1.5 text-[13px] text-ink-2"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              {status.spinner ? (
                <IconLoader2
                  size={14}
                  stroke={2}
                  className="shrink-0 animate-spin"
                  aria-hidden
                />
              ) : (
                <IconCheck
                  size={14}
                  stroke={2}
                  className="shrink-0 text-green"
                  aria-hidden
                />
              )}
              {status.text}
            </p>
          ) : error ? (
            <p
              key={error}
              className="mt-3 rounded-[8px] bg-red-tint px-3 py-2 text-[13px] leading-relaxed text-ink"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </DialogShell>
  );
}
