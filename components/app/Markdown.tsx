"use client";

import { Suspense, lazy, useMemo } from "react";
import { MarkdownBody, type MarkdownBodyProps } from "@/components/app/MarkdownBody";

// KaTeX + remark-math load only when a reply actually contains math. The
// model is instructed to delimit math with $$, so \( and \[ are backstops.
const LazyWithMath = lazy(() =>
  import("./MarkdownWithMath").then((m) => ({ default: m.MarkdownWithMath })),
);

function hasMathDelimiters(text: string): boolean {
  return (
    text.includes("$$") || text.includes("\\(") || text.includes("\\[")
  );
}

export type MarkdownProps = Omit<MarkdownBodyProps, "math">;

/* Markdown — the assistant's reply. Plain chats render MarkdownBody with
 * no math plugin; math replies lazy-load the KaTeX chunk (with the plain
 * body as the Suspense fallback so nothing flashes). */
export function Markdown(props: MarkdownProps) {
  const needsMath = useMemo(
    () => hasMathDelimiters(props.children),
    [props.children],
  );
  if (!needsMath) return <MarkdownBody {...props} />;
  return (
    <Suspense fallback={<MarkdownBody {...props} />}>
      <LazyWithMath {...props} />
    </Suspense>
  );
}
