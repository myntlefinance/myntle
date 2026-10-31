"use client";

import { Streamdown, type Components } from "streamdown";
import { cn } from "@/lib/utils";

/* Markdown — the assistant's reply.
 *
 * Text parts stream in as markdown and render through Streamdown, which
 * completes unterminated syntax while a reply is still arriving, so a
 * half-open bold or code fence renders instead of flashing or breaking.
 * The root carries the reply typography, which the paragraphs inherit,
 * because streamdown leaves them unstyled on purpose.
 *
 * This file is the one place the reply's text customizations attach:
 * link treatment, hover cards, model-delivered custom elements — all of
 * them arrive as entries in the `components` map or as remark plugins.
 * Scope every addition under `.md-prose` in globals.css rather than
 * reaching outside it, so nothing here styles the rest of the app.
 */
export function Markdown({
  children,
  isAnimating = false,
  caret = false,
  className,
  components,
}: {
  /** the text part(s) being rendered, exactly as the model wrote them */
  children: string;
  /** true while this part is still streaming */
  isAnimating?: boolean;
  /** blink a caret at the end of the newest block while streaming */
  caret?: boolean;
  className?: string;
  /** streamdown element overrides, passed straight through */
  components?: Components;
}) {
  return (
    <Streamdown
      isAnimating={isAnimating}
      caret={caret ? "block" : undefined}
      className={cn("md-prose text-[14px] leading-[1.6] text-ink", className)}
      components={components}
    >
      {children}
    </Streamdown>
  );
}
