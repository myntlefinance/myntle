"use client";

import { useCallback, useState } from "react";
import {
  IconArrowLeft,
  IconChevronRight,
  IconLoader2,
  IconUser,
  IconUserPlus,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { useAuth } from "@/lib/auth/auth-provider";
import { friendlyPasskeyError } from "@/lib/auth/passkey-client";

export type PasskeyMode = "create" | "signin";

/**
 * The passkey ceremony, shared by the login dialog and the passkey dialog.
 *
 * Creating and logging in are two different promises: one makes a new
 * account, the other finds an existing discoverable credential for this
 * site. Keeping the state here means both entry points say the same thing
 * while the browser prompt is open.
 */
export function usePasskeyLogin() {
  const { createPasskeyAccount, signInWithPasskey } = useAuth();
  const [mode, setMode] = useState<PasskeyMode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const run = useCallback(
    async (next: PasskeyMode) => {
      setMode(next);
      setSubmitting(true);
      setError(null);
      try {
        if (next === "create") await createPasskeyAccount();
        else await signInWithPasskey();
        setSucceeded(true);
      } catch (cause) {
        setError(friendlyPasskeyError(cause));
      } finally {
        setSubmitting(false);
      }
    },
    [createPasskeyAccount, signInWithPasskey],
  );

  const reset = useCallback(() => {
    setMode(null);
    setSubmitting(false);
    setError(null);
    setSucceeded(false);
  }, []);

  const pending = submitting ? "Waiting for your passkey…" : null;
  const notice = succeeded
    ? mode === "create"
      ? "Account created."
      : "Logged in."
    : (error ?? pending);

  return { mode, submitting, succeeded, error, notice, run, reset };
}

export type PasskeyFlow = ReturnType<typeof usePasskeyLogin>;

/**
 * The two ways into a passkey account, in the same card language as the
 * wallet picker. A new user creates a credential; an existing user lets the
 * browser offer the credentials it already holds for this site.
 */
export function PasskeyOptions({
  flow,
  onBack,
}: {
  flow: PasskeyFlow;
  /** The login dialog uses this to return to the wallet options. */
  onBack?: () => void;
}) {
  const locked = flow.submitting || flow.succeeded;

  return (
    <div>
      <div className="grid gap-1.5">
        <button
          type="button"
          disabled={locked}
          onClick={() => void flow.run("create")}
          className="flex w-full items-center gap-3 rounded-[10px] border border-line bg-page px-3.5 py-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-hover disabled:opacity-60"
        >
          <span className="flex size-9 shrink-0 items-center justify-center text-ink-2">
            <IconUserPlus size={17} stroke={1.8} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">
              New user
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-2">
              Create a passkey account.
            </span>
          </span>
          {flow.submitting && flow.mode === "create" ? (
            <IconLoader2
              size={15}
              stroke={1.8}
              className="shrink-0 animate-spin text-ink-3"
            />
          ) : (
            <IconChevronRight
              size={15}
              stroke={1.8}
              className="shrink-0 text-ink-3"
              aria-hidden
            />
          )}
        </button>

        <button
          type="button"
          disabled={locked}
          onClick={() => void flow.run("signin")}
          className="flex w-full items-center gap-3 rounded-[10px] border border-line bg-page px-3.5 py-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-hover disabled:opacity-60"
        >
          <span className="flex size-9 shrink-0 items-center justify-center text-ink-2">
            <IconUser size={17} stroke={1.8} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">
              Existing user
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-2">
              Use a passkey you already have.
            </span>
          </span>
          {flow.submitting && flow.mode === "signin" ? (
            <IconLoader2
              size={15}
              stroke={1.8}
              className="shrink-0 animate-spin text-ink-3"
            />
          ) : (
            <IconChevronRight
              size={15}
              stroke={1.8}
              className="shrink-0 text-ink-3"
              aria-hidden
            />
          )}
        </button>
      </div>

      {/* the notice grows the dialog instead of jumping it */}
      <div
        className="grid"
        style={{
          gridTemplateRows: flow.notice ? "1fr" : "0fr",
          transition: "grid-template-rows 240ms var(--ease-out-strong)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          {flow.succeeded ? (
            <p
              key="ok"
              className="mt-3 rounded-[8px] bg-green-tint px-3 py-2 text-[13px] text-ink"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              {flow.notice}
            </p>
          ) : flow.error ? (
            <p
              key={flow.error}
              className="mt-3 rounded-[8px] bg-red-tint px-3 py-2 text-[13px] text-ink"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              {flow.error}
            </p>
          ) : flow.notice ? (
            <p
              key="pending"
              className="mt-3 rounded-[8px] bg-inset px-3 py-2 text-[13px] text-ink"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              {flow.notice}
            </p>
          ) : null}
        </div>
      </div>

      {onBack ? (
        <div className="mt-3 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            disabled={locked}
          >
            <IconArrowLeft size={14} stroke={1.8} className="shrink-0" />
            Go Back
          </Button>
        </div>
      ) : null}
    </div>
  );
}
