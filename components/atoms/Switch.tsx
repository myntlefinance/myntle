"use client";

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-4.5 w-7.5 shrink-0 rounded-full transition-colors duration-150
        ${checked ? "bg-accent" : "bg-line-strong"}`}
    >
      <span
        className="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white
          shadow-btn transition-transform duration-150"
        style={{
          transform: checked ? "translateX(12px)" : "translateX(0)",
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      />
    </button>
  );
}
