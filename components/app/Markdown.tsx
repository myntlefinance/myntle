"use client";

import {
  useMemo,
  useRef,
  createContext,
  useContext,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { Streamdown, type Components, type CustomRenderer } from "streamdown";
import { math } from "@streamdown/math";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { PeleDiagram } from "@/components/app/PeleDiagram";
import { MarkdownLink } from "@/components/app/MarkdownLink";
import { MarkdownCode } from "@/components/app/MarkdownCode";
import {
  MarkdownTable,
  type MarkdownTableProps,
} from "@/components/app/MarkdownTable";

const peleRenderer: CustomRenderer = {
  language: "mermaid",
  component: PeleDiagram,
};

const streamdownPlugins = {
  math,
  renderers: [peleRenderer],
};

const TableTitleContext = createContext<{ current: string | null }>({
  current: null,
});

function extractChildrenText(children: ReactNode): string {
  if (children == null) return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(extractChildrenText).join("");
  }
  if (typeof children === "object" && "props" in children) {
    return extractChildrenText(
      (children as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}

function createHeadingComponent(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function HeadingComponent({
    children,
    node: _node,
    ...props
  }: HTMLAttributes<HTMLHeadingElement> & { node?: unknown }) {
    const ctx = useContext(TableTitleContext);
    const text = extractChildrenText(children).trim();
    if (ctx && text) ctx.current = text;
    return (
      <Tag data-table-title="" {...props}>
        {children}
      </Tag>
    );
  };
}

function TableParagraphComponent({
  children,
  node: _node,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) {
  const ctx = useContext(TableTitleContext);
  const text = extractChildrenText(children).trim();
  const tablePrefixMatch = text.match(
    /^(?:table\s*[:\-]\s*|\[)(.+?)(?:\])?$/i,
  );
  const isBoldOnly =
    Array.isArray(children) &&
    children.length === 1 &&
    typeof children[0] === "object" &&
    children[0] !== null &&
    (children[0] as { type?: string }).type === "strong";

  if (tablePrefixMatch) {
    if (ctx) ctx.current = tablePrefixMatch[1].trim();
    return (
      <p data-table-title="" {...props}>
        {children}
      </p>
    );
  }
  if (isBoldOnly && text.length > 0 && text.length < 80) {
    if (ctx) ctx.current = text;
    return (
      <p data-table-title="" {...props}>
        {children}
      </p>
    );
  }
  if (ctx) ctx.current = null;
  return <p {...props}>{children}</p>;
}

function TableWrapper(props: MarkdownTableProps) {
  const ctx = useContext(TableTitleContext);
  const title = props.title || ctx?.current || undefined;
  if (ctx) ctx.current = null;
  return <MarkdownTable {...props} title={title} />;
}

/* Markdown — the assistant's reply.
 *
 * Text parts stream in as markdown and render through Streamdown, which
 * completes unterminated syntax while a reply is still arriving, so a
 * half-open bold or code fence renders instead of flashing or breaking.
 * The root carries the reply typography, which the paragraphs inherit,
 * because streamdown leaves them unstyled on purpose.
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
  const titleRef = useRef<string | null>(null);

  const mergedComponents = useMemo(
    () => ({
      a: MarkdownLink,
      code: MarkdownCode,
      table: TableWrapper,
      td: ({ children }: { children?: ReactNode }) => <>{children}</>,
      th: ({ children }: { children?: ReactNode }) => <>{children}</>,
      h1: createHeadingComponent("h1"),
      h2: createHeadingComponent("h2"),
      h3: createHeadingComponent("h3"),
      h4: createHeadingComponent("h4"),
      h5: createHeadingComponent("h5"),
      h6: createHeadingComponent("h6"),
      p: TableParagraphComponent,
      ...components,
    }),
    [components],
  );

  return (
    <TableTitleContext.Provider value={titleRef}>
      <Streamdown
        plugins={streamdownPlugins}
        linkSafety={{ enabled: false }}
        isAnimating={isAnimating}
        caret={caret && isAnimating ? "block" : undefined}
        className={cn(
          "md-prose text-[14px] leading-[1.6] text-ink",
          className,
        )}
        components={mergedComponents}
      >
        {children}
      </Streamdown>
    </TableTitleContext.Provider>
  );
}
