"use client";

import { useState, type ComponentType } from "react";
import CodeBlock from "@/components/primitives/CodeBlock";

/**
 * The frame around one prototype.
 *
 * It renders every variant of the prototype side by side, and shows the
 * source underneath so the finished markup can be copied straight into the
 * application.
 */
export function LabFrame({
  title,
  caption,
  variants,
  code,
  file,
  Component,
}: {
  title: string;
  caption: string;
  variants: string[];
  code: string;
  file: string;
  Component: ComponentType<{ variant?: string }>;
}) {
  const [showSource, setShowSource] = useState(false);

  return (
    <section className="border-t border-line px-6 py-7 first:border-t-0">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium text-ink">{title}</h2>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
            {caption}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="shrink-0 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-2 shadow-btn transition-colors duration-100 hover:bg-hover"
        >
          {showSource ? "Hide the code" : "Show the code"}
        </button>
      </header>

      <div className="mt-4 flex flex-wrap items-start gap-3 rounded-[10px] border border-dashed border-line bg-inset p-4">
        {variants.map((variant) => (
          <div key={variant} className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-3">{variant}</span>
            <Component variant={variant} />
          </div>
        ))}
      </div>

      {showSource ? (
        <div className="mt-4">
          <CodeBlock
            code={code}
            filename={file}
            labels={{ copy: "Copy", copied: "Copied" }}
          />
        </div>
      ) : null}
    </section>
  );
}
