"use client";

import { SkeletonBox } from "skullet/react";

/* Static placeholder while a saved thread or deleted chat loads. Deliberately
 * plain: no staged blur-fade, so switching chats never replays the entrance.
 * Row wrappers mirror the message stream exactly (same max-w, same gutters) so
 * the skeleton sits precisely where the messages will land on every screen.
 * Every bar is a Skullet box, so it joins the page's one shimmer and follows
 * the theme instead of running its own pulse. */
export function ThreadSkeleton({
  bottomPad,
  narrow = false,
}: {
  bottomPad?: number;
  narrow?: boolean;
}) {
  return (
    <div
      aria-busy="true"
      className={`flex flex-col gap-8 pt-8 ${narrow ? "px-4" : "px-4 sm:px-8 lg:px-12"}`}
      style={
        bottomPad !== undefined
          ? { paddingBottom: bottomPad }
          : { paddingBottom: "2rem" }
      }
    >
      <span className="sr-only" role="status">
        Loading chat.
      </span>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="flex justify-end pl-10 sm:pl-24">
          <SkeletonBox width={176} height={40} radius={12} />
        </div>
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="flex flex-col gap-2">
          <SkeletonBox width="100%" height={14} radius={4} />
          <SkeletonBox width="91.6667%" height={14} radius={4} />
          <SkeletonBox width="60%" height={14} radius={4} />
        </div>
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="flex justify-end pl-10 sm:pl-24">
          <SkeletonBox width={224} height={40} radius={12} />
        </div>
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="flex flex-col gap-2">
          <SkeletonBox width="100%" height={14} radius={4} />
          <SkeletonBox width="83.3333%" height={14} radius={4} />
        </div>
      </div>
    </div>
  );
}

export default ThreadSkeleton;
