"use client";

import { Button } from "@/components/atoms/Button";

/**
 * A prototype of the buttons the product needs.
 *
 * The approval flow is the reason the primary weight has to be obvious, so the
 * variants are ordered by how much they are used rather than by how they look.
 */
export default function ActionButton({ variant }: { variant?: string }) {
  if (variant === "Secondary") {
    return (
      <Button variant="secondary" className="h-8 px-3 text-[13px]">
        Cancel
      </Button>
    );
  }

  if (variant === "Ghost") {
    return (
      <Button variant="quiet" className="h-8 px-2 text-[13px] text-ink-2">
        View the receipt
      </Button>
    );
  }

  if (variant === "Danger") {
    return (
      <Button
        variant="secondary"
        className="h-8 px-3 text-[13px] text-red"
      >
        Reject this trade
      </Button>
    );
  }

  return (
    <Button variant="primary" className="h-8 px-3 text-[13px]">
      Approve the swap
    </Button>
  );
}
