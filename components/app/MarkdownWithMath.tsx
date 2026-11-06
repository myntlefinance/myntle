"use client";

import { math } from "@streamdown/math";
import "katex/dist/katex.min.css";
import { MarkdownBody, type MarkdownBodyProps } from "@/components/app/MarkdownBody";

/* Math path, split out so KaTeX + remark-math load only when a reply
 * actually contains math delimiters. Chosen by Markdown, never imported
 * directly. */
export function MarkdownWithMath(props: MarkdownBodyProps) {
  return <MarkdownBody {...props} math={math} />;
}
