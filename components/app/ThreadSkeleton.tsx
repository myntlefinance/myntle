"use client";

import { Skeleton } from "skullet/react";

/* The thread skeleton is measured, not drawn.
 *
 * Skullet lays the sample below out at its real size and draws a bar for
 * every line of text and every control, so the placeholder takes exactly
 * the space the messages will. That is what keeps the user bubble's action
 * row, the activity pill above a reply, and the reply's own action row from
 * appearing only after the thread loads and pushing everything around.
 *
 * The sample is deliberately plain: no staged blur-fade, so switching chats
 * never replays an entrance. It is shared with the first-paint shell, which
 * wraps it in its own skeleton rather than nesting a second one.
 *
 * The icon and image radii are not decoration. Skullet reads each element's
 * computed border-radius when it draws a control or an image, so a bare SVG
 * becomes a sharp square; the descendant utilities give every bone the same
 * soft edge the real control has. */
export function ThreadSample({
  bottomPad,
  narrow = false,
}: {
  bottomPad?: number;
  narrow?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-8 pt-8 [&_img]:rounded-[6px] [&_svg]:rounded-[4px] ${narrow ? "px-4" : "px-4 sm:px-8 lg:px-12"}`}
      style={
        bottomPad !== undefined
          ? { paddingBottom: bottomPad }
          : { paddingBottom: "2rem" }
      }
    >
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="scroll-mt-8 flex items-center justify-center py-2 select-none">
          <div className="flex items-center gap-2 text-[12px] font-medium tracking-normal text-ink-2">
            <span className="font-semibold text-ink">Today</span>
            <span className="text-ink-3">|</span>
            <span>10:33 AM</span>
          </div>
        </div>
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <UserSample text="Swap 100 USDC for NEAR" />
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <AssistantSample text="You hold 1,250 USDC on Base and 470.50 USDC in the settlement ledger, plus a small amount of ETH. The swap would leave your stable balance untouched and settle in NEAR." />
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <UserSample text="What do I hold across my wallets?" />
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <AssistantSample text="Your balances are split across Base and the settlement ledger. Nothing is below the dust threshold." />
      </div>
    </div>
  );
}

/**
 * The user turn, in the same shape `UserBubble` renders, without its entrance
 * animation: `fade-up` starts 8px low, and skullet measures the transformed
 * rect, which would put every user bone 8px below where the bubble rests.
 */
function UserSample({ text }: { text: string }) {
  return (
    <div className="group flex flex-col items-end pl-10 sm:pl-24">
      <div className="rounded-xl bg-field px-3.5 py-2 text-[13px] leading-relaxed text-ink shadow-hairline">
        {text}
      </div>
      <div className="mt-1 flex justify-end">
        <div
          className="flex items-center gap-0.5 opacity-0"
          aria-hidden
          {...{ "skullet-ignore": "" }}
        >
          <span className="size-7" />
          <span className="size-7" />
          <span className="size-7" />
        </div>
      </div>
    </div>
  );
}

/**
 * One assistant turn, in the same shape `LiveResponse` renders: the settled
 * activity pill, the reply, then the action row that is present but invisible
 * until hover. The pill and the action row are the parts a text-only
 * placeholder misses, and they are most of a turn's height.
 */
function AssistantSample({ text }: { text: string }) {
  return (
    <article className="min-w-0">
      <div className="flex flex-col gap-4">
        <div className="w-full max-w-95">
          <div className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-3"
              aria-hidden
              {...{ "skullet-ignore": "" }}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12h8M12 8v8" />
            </svg>
            <span className="text-[13px] font-medium text-ink-2">
              Checked your balances
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              {...{ "skullet-ignore": "" }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
        <p className="text-[14px] leading-[1.6] text-ink">{text}</p>
      </div>
      {/* Present in the real turn even at rest, so its height is reserved. */}
      <div
        className="mt-2.5 flex items-center gap-0.5 opacity-0"
        aria-hidden
        {...{ "skullet-ignore": "" }}
      >
        <span className="size-7" />
        <span className="size-7" />
        <span className="size-7" />
      </div>
    </article>
  );
}

/** Static placeholder while a saved thread or deleted chat loads. */
export function ThreadSkeleton({
  bottomPad,
  narrow = false,
}: {
  bottomPad?: number;
  narrow?: boolean;
}) {
  return (
    <Skeleton loading label="Loading chat.">
      <ThreadSample bottomPad={bottomPad} narrow={narrow} />
    </Skeleton>
  );
}

export default ThreadSkeleton;
