"use client";

import { useState } from "react";
import MorphMoney from "@/components/finance/MorphMoney";

/* ─────────────────────────────────────────────────────────
 * MORPH MONEY (lab prototype)
 * The hero total gliding between values instead of cutting.
 * small-delta steps a few dollars, large-delta jumps an order
 * of magnitude, masked stays plain, and reduced-motion renders
 * the same value with the morph forced off. Press Step to watch.
 * ───────────────────────────────────────────────────────── */

const STEPS: Record<string, number[]> = {
  small: [3010.0, 3014.27, 3008.93, 3021.5],
  large: [120.4, 4892.17, 961.05, 12410.88],
};

function Stepper({
  label,
  steps,
  disabled = false,
}: {
  label: string;
  steps: number[];
  disabled?: boolean;
}) {
  const [index, setIndex] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
        <MorphMoney
          value={steps[index % steps.length]}
          disabled={disabled}
        />
      </p>
      <button
        type="button"
        onClick={() => setIndex((i) => i + 1)}
        aria-label={label}
        className="self-start rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-2 shadow-btn transition-colors duration-100 hover:bg-hover"
      >
        Step
      </button>
    </div>
  );
}

export default function MorphMoneySample({ variant }: { variant?: string }) {
  if (variant === "masked") {
    return (
      <p className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
        <MorphMoney value={0} masked />
      </p>
    );
  }
  if (variant === "reduced-motion") {
    return <Stepper label="Step without morphing" steps={STEPS.large} disabled />;
  }
  if (variant === "large-delta") {
    return <Stepper label="Step to the next large total" steps={STEPS.large} />;
  }
  return <Stepper label="Step to the next small total" steps={STEPS.small} />;
}
