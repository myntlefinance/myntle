"use client";

import { useRouter } from "next/navigation";
import {
  IconChevronLeft,
  IconError404,
  IconPencil,
  IconWallet,
} from "@tabler/icons-react";
import SidebarNav from "@/components/primitives/SidebarNav";
import { Button } from "@/components/atoms/Button";
import { AccountControl } from "@/components/app/AccountControl";
import { useThreads, useTrashed } from "@/components/app/threadQueries";
import { prefetchThread } from "@/components/app/threadCache";
import { useAuth } from "@/lib/auth/auth-provider";

/**
 * The 404 as an app page.
 *
 * Unmatched URLs land outside the `(app)` route group, so the page supplies
 * the provider boundary itself and draws the same shell every account page
 * does: canvas, rail, page card, 44px header, and the empty-state rhythm.
 * The rail is real — recents, trash count, and the account control — so a
 * signed-in visitor is never stranded in a stripped-down copy of the app.
 */
export function NotFoundView() {
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === "signed-in";
  const { data: threads = [] } = useThreads(signedIn);
  const { data: trashed = [] } = useTrashed(50, signedIn);

  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink lg:pl-0">
      <SidebarNav
        fill
        className="hidden lg:flex"
        recents={threads.map((t) => ({
          id: t.id,
          label: t.label ?? "New chat",
        }))}
        onPick={(id) => router.push(`/chat/${encodeURIComponent(id)}`)}
        onNewChat={() => router.push("/")}
        onHoverThread={prefetchThread}
        onOpenPortfolio={() => router.push("/portfolio")}
        onOpenHistory={() => router.push("/history")}
        onOpenTrash={() => router.push("/trash")}
        trashCount={trashed.length}
        footer={<AccountControl />}
        footerCompact={<AccountControl compact />}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
          <header className="flex h-11 shrink-0 items-center border-b border-line px-4">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => router.push("/")}
                aria-label="Back to chat"
                className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink lg:hidden"
              >
                <IconChevronLeft size={16} stroke={2} />
              </button>
              <span className="flex size-5 shrink-0 items-center justify-center text-ink-3">
                <IconError404 size={17} stroke={1.7} aria-hidden />
              </span>
              <h1 className="truncate text-[14px] font-medium text-ink">
                Page not found
              </h1>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-4 sm:px-6 [scrollbar-gutter:stable]">
            <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
              <IconError404
                size={216}
                stroke={1.2}
                aria-hidden
                className="text-ink-2"
              />
              <h2 className="-mt-10 text-[15px] font-medium text-ink">
                This page does not exist.
              </h2>
              <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
                The link may be wrong, or the page may have moved.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => router.push("/")}
                >
                  <IconPencil size={16} stroke={1.8} aria-hidden />
                  New chat
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => router.push("/portfolio")}
                >
                  <IconWallet size={16} stroke={1.8} aria-hidden />
                  Portfolio
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default NotFoundView;
