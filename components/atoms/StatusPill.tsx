import { cn } from "@/lib/utils";

type Tone = "green" | "orange" | "yellow" | "red" | "accent" | "neutral";

const TONES: Record<Tone, { cls: string; ring: string }> = {
  green: { cls: "bg-green-tint text-green", ring: "0 0 0 1px color-mix(in oklch, var(--green) 28%, transparent)" },
  orange: { cls: "bg-orange-tint text-orange", ring: "0 0 0 1px color-mix(in oklch, var(--orange) 28%, transparent)" },
  yellow: { cls: "bg-orange-tint text-attention", ring: "0 0 0 1px color-mix(in oklch, var(--attention) 30%, transparent)" },
  red: { cls: "bg-red-tint text-red", ring: "0 0 0 1px color-mix(in oklch, var(--red) 28%, transparent)" },
  accent: { cls: "bg-accent-tint text-accent-ink", ring: "0 0 0 1px color-mix(in oklch, var(--accent) 28%, transparent)" },
  neutral: { cls: "bg-field text-ink-2", ring: "var(--shadow-hairline)" },
};

/** Status badge — the ValuePill treatment at status size. Text alone
 *  carries the state; no dot, no icon. */
export function StatusPill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium leading-none",
        t.cls,
        className,
      )}
      style={{ boxShadow: t.ring }}
    >
      {children}
    </span>
  );
}
