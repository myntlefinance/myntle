/* Static placeholder while a saved thread or deleted chat loads. Deliberately
 * plain: no staged blur-fade, so switching chats never replays the entrance.
 * Row wrappers mirror the message stream exactly (same max-w, same gutters) so
 * the skeleton sits precisely where the messages will land on every screen. */
export function ThreadSkeleton({
  bottomPad,
  narrow = false,
}: {
  bottomPad?: number;
  narrow?: boolean;
}) {
  return (
    <div
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
          <div className="h-10 w-44 animate-pulse rounded-xl bg-hover-2" />
        </div>
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="flex animate-pulse flex-col gap-2">
          <div className="h-3.5 w-full rounded-[4px] bg-hover-2" />
          <div className="h-3.5 w-11/12 rounded-[4px] bg-hover-2" />
          <div className="h-3.5 w-3/5 rounded-[4px] bg-hover-2" />
        </div>
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="flex justify-end pl-10 sm:pl-24">
          <div className="h-10 w-56 animate-pulse rounded-xl bg-hover-2" />
        </div>
      </div>
      <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
        <div className="flex animate-pulse flex-col gap-2">
          <div className="h-3.5 w-full rounded-[4px] bg-hover-2" />
          <div className="h-3.5 w-10/12 rounded-[4px] bg-hover-2" />
        </div>
      </div>
    </div>
  );
}

export default ThreadSkeleton;
