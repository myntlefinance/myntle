"use client";

import { Skeleton } from "skullet/react";
import {
  IconChevronLeft,
  IconCoins,
  IconDots,
  IconHistory,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconWallet,
} from "@tabler/icons-react";
import SidebarNav from "@/components/primitives/SidebarNav";
import { ThreadSample } from "@/components/app/ThreadSkeleton";
import { HistoryListSample } from "@/components/app/HistoryList";
import { PortfolioSkeletonBody } from "@/components/app/PortfolioSkeletonBody";
import { SAMPLE_PORTFOLIO } from "@/components/app/portfolioCache";
import type { PortfolioTab } from "@/components/app/portfolioTabs";
import { TrashSample } from "@/components/app/TrashSample";

export type AppShellVariant =
  | "thread"
  | "empty"
  | "portfolio"
  | "history"
  | "trash"
  | "trash-thread"
  | "page";

const LABELS: Record<AppShellVariant, string> = {
  thread: "Loading chat.",
  empty: "Loading chat.",
  portfolio: "Loading your portfolio.",
  history: "Loading your history.",
  trash: "Loading your trash.",
  "trash-thread": "Loading deleted chat.",
  page: "Loading.",
};

const SAMPLE_RECENTS = [
  { id: "sample-1", label: "Swap 100 USDC for NEAR" },
  { id: "sample-2", label: "What do I hold across my wallets?" },
  { id: "sample-3", label: "Show my portfolio balances" },
  { id: "sample-4", label: "What can I trade from here?" },
];

const SUGGESTIONS = [
  { label: "What would 100 USDC buy in NEAR?", icon: "quote" },
  { label: "Swap 100 USDC for NEAR", icon: "swap" },
  { label: "What do I hold?", icon: "balances" },
] as const;

function noop() {}

/**
 * The first-paint shell.
 *
 * The wallet providers are client-only, so before they mount there is no
 * Harness to hold a skeleton. Rather than drawing the shell by hand and
 * hoping the numbers match, this renders a sample of the real shell and lets
 * skullet measure it: the rail keeps its 235px, the title bar its 44px, the
 * page card its radius and inset, and the composer its exact height and
 * alignment. Every bar is therefore drawn where the real text and controls
 * will land, including the padding and margins around them.
 */
export function AppShellSkeleton({
  variant = "thread",
  tab,
}: {
  variant?: AppShellVariant;
  /** The `?tab=` value the portfolio shell opens on, when known. */
  tab?: PortfolioTab;
}) {
  return (
    <Skeleton loading label={LABELS[variant]}>
      <ShellSample variant={variant} tab={tab} />
    </Skeleton>
  );
}

function ShellSample({
  variant,
  tab,
}: {
  variant: AppShellVariant;
  tab?: PortfolioTab;
}) {
  const page =
    variant === "portfolio" ||
    variant === "history" ||
    variant === "trash" ||
    variant === "page";
  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink lg:pl-0 [&_.sidebar-copy.sticky]:bg-transparent [&_img]:rounded-[6px] [&_svg]:rounded-[4px]">
      {/* The rail's sticky "Chats" header has a canvas background. Left
       * opaque, skullet draws the whole 219×32 row as one bone and hides the
       * label and search icon; transparent here lets it measure the contents.
       * The image and SVG radii are what skullet reads for each bone, so an
       * icon is never a sharp square. */}
      <SidebarNav
        fill
        className="hidden lg:flex"
        recents={SAMPLE_RECENTS}
        onNewChat={noop}
        onPick={noop}
        onOpenTrash={noop}
        onOpenPortfolio={noop}
        onOpenHistory={noop}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-h-0 flex-1 gap-2.5">
          <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
            {page ? (
              <PageHeader variant={variant} />
            ) : variant === "trash-thread" ? (
              <TrashThreadHeader />
            ) : (
              <ThreadTitleBar />
            )}

            {variant === "thread" ? (
              <ThreadBody />
            ) : variant === "empty" ? (
              <EmptyBody />
            ) : variant === "trash-thread" ? (
              <TrashThreadBody />
            ) : variant === "trash" ? (
              <TrashBody />
            ) : variant === "history" ? (
              <HistoryBody />
            ) : variant === "portfolio" ? (
              <PortfolioBody tab={tab} />
            ) : (
              <GenericBody />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/** The real title bar: 44px, the title's own 14px line, and both controls. */
function ThreadTitleBar() {
  return (
    <div className="group flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:pl-4">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="block min-w-0 max-w-full truncate text-[14px] font-medium text-ink-2">
          New chat
        </span>
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 opacity-0"
          {...{ "skullet-ignore": "" }}
        >
          <IconPencil size={15} stroke={1.9} />
        </span>
      </div>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3"
        {...{ "skullet-ignore": "" }}
      >
        <IconPlus size={15} stroke={2} />
      </span>
    </div>
  );
}

function PageHeader({ variant }: { variant: AppShellVariant }) {
  const meta =
    variant === "portfolio"
      ? { title: "Portfolio", icon: <IconWallet size={17} stroke={1.7} /> }
      : variant === "history"
        ? { title: "History", icon: <IconHistory size={17} stroke={1.7} /> }
        : variant === "trash"
          ? { title: "Trash", icon: <IconTrash size={17} stroke={1.7} /> }
          : { title: "Page", icon: <IconDots size={17} stroke={1.7} /> };

  return (
    <header className="flex h-11 shrink-0 items-center border-b border-line px-4">
      <div className="flex w-full min-w-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 lg:hidden"
            {...{ "skullet-ignore": "" }}
          >
            <IconChevronLeft size={16} stroke={2} />
          </span>
          <span
            className="flex size-5 shrink-0 items-center justify-center text-ink-3"
            {...{ "skullet-ignore": "" }}
          >
            {meta.icon}
          </span>
          <h1 className="truncate text-[14px] font-medium text-ink">
            {meta.title}
          </h1>
        </div>
      </div>
    </header>
  );
}

function TrashThreadHeader() {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className="mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3"
          {...{ "skullet-ignore": "" }}
        >
          <IconChevronLeft size={16} stroke={2} />
        </span>
        <span className="block min-w-0 max-w-full truncate text-[14px] font-medium text-ink">
          Deleted chat
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-normal text-ink">
          Restore
        </span>
        <span className="flex h-7 items-center gap-1 rounded-full bg-red-tint px-2.5 text-[12px] font-normal text-red">
          Delete
        </span>
      </div>
    </div>
  );
}

function ThreadBody() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-slim [scrollbar-gutter:stable]">
        {/* The composer lives in the scroll container's content box, so it
         * inherits the reserved scrollbar gutter on the first paint. The
         * floating copy in Harness needs a measured margin for the same
         * alignment; here the layout does it without a state update. */}
        <div className="flex min-h-full flex-col">
          <ThreadSample bottomPad={16} />
          <div className="sticky bottom-0 mt-auto">
            {/* Decorative fade: ignored so skullet does not turn the whole
             * gradient into a 956×164 bone over the composer. */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0"
              {...{ "skullet-ignore": "" }}
              style={{
                height: 164,
                background:
                  "linear-gradient(to top, var(--page) 64%, transparent)",
              }}
            />
            <div className="relative px-4 pb-6 sm:px-8 lg:px-12">
              <div className="mx-auto w-full max-w-[720px]">
                <ComposerSample />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyBody() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim [scrollbar-gutter:stable]">
      <div className="mx-auto flex min-h-full w-full flex-col justify-center px-4 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[720px]">
          <h1 className="text-[26px] font-normal tracking-[-0.02em] text-ink">
            <span className="block text-ink-3">
              Your money, in plain language
            </span>
            <span className="block">Ask for a trade and watch it settle.</span>
          </h1>

          <div className="relative mt-7">
            <ComposerSample />
          </div>

          <div className="mt-6 flex flex-col">
            {SUGGESTIONS.map((item) => (
              <div
                key={item.label}
                className="-mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 text-left text-[14px] text-ink"
              >
                <span className="text-ink-3" {...{ "skullet-ignore": "" }}>
                  {item.icon === "swap" ? (
                    <IconRefresh size={15} stroke={1.9} />
                  ) : item.icon === "balances" ? (
                    <IconWallet size={15} stroke={1.9} />
                  ) : (
                    <IconCoins size={15} stroke={1.9} />
                  )}
                </span>
                <span className="min-w-0 truncate">{item.label}</span>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-5 pl-0.5 text-[13px] text-ink-3">
              <span className="flex items-center gap-2 py-1">
                <span {...{ "skullet-ignore": "" }}>
                  <IconRefresh size={14} stroke={2} />
                </span>
                Shuffle suggestions
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The composer, as one measured block.
 *
 * Its height is the real one — 68px input, a 28px control row, a 10px gap
 * and 14px of padding — but it is marked `skullet-block`, so the skeleton
 * reads as one rounded surface instead of a pile of control-shaped bars.
 */
function ComposerSample() {
  return (
    <div
      className="relative isolate flex flex-col gap-2.5 overflow-hidden rounded-[22px] border border-line bg-surface p-3.5 shadow-card"
      {...{ "skullet-block": "" }}
    >
      <div className="flex flex-col gap-1.5">
        <div className="min-h-[68px] px-2 py-2 text-[14px] leading-5 text-ink-3">
          Reply
        </div>
        <div className="flex h-7 items-center gap-1">
          <span className="size-7" />
          <span className="flex h-7 items-center gap-1 px-1.5 text-[12px] font-medium text-ink-2">
            GPT-6 Luna
          </span>
          <span className="ml-auto flex items-center gap-1">
            <span className="size-7" />
            <span className="size-7" />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared skeleton bodies. Each one renders the same sample component the
 * page itself renders inside its data-bound <Skeleton>, so the first
 * paint and the page skeleton can never drift. The shell only adds the
 * scroll container and width cap to match the page layout; the list,
 * table, and rows come from the shared modules.
 */
function PortfolioBody({ tab }: { tab?: PortfolioTab }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-4 sm:px-6 [scrollbar-gutter:stable]">
      <div className="w-full">
        <PortfolioSkeletonBody
          snapshot={SAMPLE_PORTFOLIO}
          tab={tab}
          superLocked={tab === "Super account"}
        />
      </div>
    </div>
  );
}

function HistoryBody() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-4 sm:px-6 [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[860px]">
        <HistoryListSample />
      </div>
    </div>
  );
}

function TrashBody() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center px-4 pt-2.5">
        <div className="flex h-7.5 w-1/2 min-w-[200px] items-center overflow-hidden rounded-control bg-field px-2.5 text-ink-2 shadow-hairline">
          <span
            className="flex shrink-0 items-center justify-center text-ink-3"
            {...{ "skullet-ignore": "" }}
          >
            <IconSearch size={13} stroke={2} />
          </span>
          <span className="ml-2 min-w-0 flex-1 text-[12.5px]">
            Search deleted chats
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-3 py-1.5 [scrollbar-gutter:stable]">
        <TrashSample />
      </div>
    </div>
  );
}

function TrashThreadBody() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-slim [scrollbar-gutter:stable]">
        <ThreadSample bottomPad={32} />
      </div>
    </div>
  );
}

function GenericBody() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-6 sm:px-6 [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[860px]">
        <div className="text-[14px] font-medium text-ink">Page</div>
        <div className="mt-5 flex flex-col gap-3">
          {[72, 58, 81, 64, 49].map((width) => (
            <div key={width} className="flex items-center gap-3">
              <span className="size-7 shrink-0 rounded-[7px] bg-field" />
              <span
                className="text-[14px] text-ink"
                style={{ width: `${width}%` }}
              >
                Loading
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AppShellSkeleton;
