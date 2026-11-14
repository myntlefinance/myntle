"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";

/**
 * Route-level error boundary. A render throw blanks the shell without this;
 * in a money app a white screen mid-approval is a safety issue, not polish.
 * Keeps the primitives' button style and offers a retry plus a way home.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error("[app] route error", error.message.slice(0, 200));
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[720px] flex-col items-center justify-center px-4 py-10 text-center">
      <h1 className="text-[20px] font-medium tracking-[-0.01em] text-ink">
        Something went wrong.
      </h1>
      <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-ink-2">
        The page hit an error and could not render. Your chats and balances are
        safe; try again or start a new chat.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <Button type="button" variant="secondary" size="md" onClick={reset}>
          Try again
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => {
            router.push("/");
          }}
        >
          New chat
        </Button>
      </div>
    </main>
  );
}
