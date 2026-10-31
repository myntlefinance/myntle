"use client";

/**
 * A prototype of the approval row.
 *
 * The three states are the same layout with different wording, so a user can
 * tell at a glance whether their decision was received.
 */
export default function ApprovalRow({ variant }: { variant?: string }) {
  const state = variant ?? "Pending";

  const copy = ({
    Approved: {
      title: "Trade approved and submitted",
      detail: "The verifier received your signature and is filling the trade.",
      tone: "text-ink",
      dot: "bg-green",
    },
    Denied: {
      title: "Trade rejected",
      detail: "Nothing was signed and nothing moved.",
      tone: "text-ink",
      dot: "bg-red",
    },
    Pending: {
      title: "Waiting for your approval",
      detail: "The quote is held until you approve it or the price expires.",
      tone: "text-ink",
      dot: "bg-orange",
    },
  } as Record<string, { title: string; detail: string; tone: string; dot: string }>)[state] ?? {
    title: "Trade approved and submitted",
    detail: "The verifier received your signature and is filling the trade.",
    tone: "text-ink",
    dot: "bg-green",
  };

  return (
    <div className="flex w-[380px] items-start gap-2.5 rounded-[10px] border border-line bg-surface p-3.5 shadow-card">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${copy.dot}`} />
      <div className="min-w-0">
        <p className={`text-[13.5px] font-medium ${copy.tone}`}>{copy.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
          {copy.detail}
        </p>
      </div>
    </div>
  );
}
