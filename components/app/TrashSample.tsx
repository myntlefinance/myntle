"use client";

/* ─────────────────────────────────────────────────────────
 * TRASH SAMPLE
 * Static measuring rows for the deleted-chats list. Shared by
 * TrashView's waiting state and the first-paint shell so the
 * two skeletons can never drift: both render this inside a
 * <Skeleton>, the shell inside its outer page skeleton and the
 * page inside its own loading skeleton.
 * ───────────────────────────────────────────────────────── */

export const TRASH_SAMPLE_ROWS = [
  "Deleted chat",
  "Supplier records",
  "Parking ticket appeal",
  "Workload summary",
  "Off-board a supplier",
  "Batch restock function",
] as const;

export function TrashSample() {
  return (
    <div className="flex flex-col gap-0.5" aria-hidden>
      {TRASH_SAMPLE_ROWS.map((label) => (
        <div
          key={label}
          className="flex h-9 items-center gap-2.5 rounded-[6px] px-2.5 py-1"
        >
          <span className="size-3.5 shrink-0 rounded-[3px] border border-line" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
            {label}
          </span>
          <span className="shrink-0 text-[11.5px] text-ink-3">2d ago</span>
        </div>
      ))}
    </div>
  );
}

export default TrashSample;
