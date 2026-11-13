"use client";

import {
  useMemo,
  Children,
  createContext,
  useContext,
  isValidElement,
  type ReactNode,
  type HTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import dynamic from "next/dynamic";
import { Streamdown, type Components, type CustomRenderer, type MathPlugin } from "streamdown";
import { defaultRemarkPlugins } from "streamdown";
import { remarkMark } from "@/components/app/remarkMark";
import {
  buildTableTitleMap,
  tableContentKey,
} from "@/components/app/remarkTableTitles";
import { cn } from "@/lib/utils";
import { MarkdownLink } from "@/components/app/MarkdownLink";
import { MarkdownCode } from "@/components/app/MarkdownCode";
import { AssetPill } from "@/components/app/AssetPill";
import { extractChildrenText } from "@/components/app/markdownText";
import {
  MarkdownTable,
  type MarkdownTableProps,
} from "@/components/app/MarkdownTable";

// Pele (~1MB with its graph layout) stays out of the initial chat bundle:
// this chunk loads only when a mermaid fence actually mounts it.
const PeleDiagramLazy = dynamic(
  () => import("./PeleDiagram").then((m) => m.PeleDiagram),
  { ssr: false, loading: () => null },
);

/* Titles keyed by table content, derived once per render from the
 * source. The map is read-only: components look titles up, never write. */
const TableTitleMapContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
);

const peleRenderer: CustomRenderer = {
  language: "mermaid",
  component: PeleDiagramLazy as unknown as CustomRenderer["component"],
};

function createHeadingComponent(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function HeadingComponent({
    children,
    node: _node,
    ...props
  }: HTMLAttributes<HTMLHeadingElement> & { node?: unknown }) {
    void _node;
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
  void _node;
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
    return (
      <p data-table-title="" {...props}>
        {children}
      </p>
    );
  }
  if (isBoldOnly && text.length > 0 && text.length < 80) {
    return (
      <p data-table-title="" {...props}>
        {children}
      </p>
    );
  }
  return <p {...props}>{children}</p>;
}

function MarkdownMark({
  children,
}: {
  children?: ReactNode;
}) {
  return (
    <mark className="rounded-[4px] bg-accent-tint px-[3px] py-[0.5px] text-ink">
      {children}
    </mark>
  );
}

function TableWrapper(props: MarkdownTableProps) {
  const titleMap = useContext(TableTitleMapContext);
  const contentTitle = useMemo(() => {
    if (!props.node) return undefined;
    return titleMap.get(tableContentKey(props.node));
  }, [props.node, titleMap]);
  const title = props.title || contentTitle || undefined;
  return <MarkdownTable {...props} title={title} />;
}

type ListProps = HTMLAttributes<HTMLUListElement> & { node?: unknown };
type OrderedListProps = HTMLAttributes<HTMLOListElement> & { node?: unknown };
type ListItemProps = HTMLAttributes<HTMLLIElement> & { node?: unknown };

/* Lists render list-outside so wrapped lines hang under the first line of
 * text instead of falling back to the container edge. Streamdown's default
 * is list-inside, which puts the marker inline and leaves continuation
 * lines with no indent. The padding lives on the list, not the item. */
function MarkdownUl({ children, className, node: _node, ...props }: ListProps) {
  void _node;
  return (
    <ul
      data-streamdown="unordered-list"
      className={cn(
        "my-2 list-outside list-disc whitespace-normal pl-6 [&_ol]:my-1 [&_ul]:my-1",
        className,
      )}
      {...props}
    >
      {children}
    </ul>
  );
}

function MarkdownOl({
  children,
  className,
  node: _node,
  ...props
}: OrderedListProps) {
  void _node;
  return (
    <ol
      data-streamdown="ordered-list"
      className={cn(
        "my-2 list-outside list-decimal whitespace-normal pl-6 [&_ol]:my-1 [&_ul]:my-1",
        className,
      )}
      {...props}
    >
      {children}
    </ol>
  );
}

function MarkdownLi({
  children,
  className,
  node: _node,
  ...props
}: ListItemProps) {
  void _node;
  const isTaskItem =
    typeof className === "string" && className.includes("task-list-item");
  if (isTaskItem) {
    const { check, rest } = splitTaskItem(children);
    if (check) {
      return (
        <li
          data-streamdown="list-item"
          className={cn("py-1 pl-1 [&>p]:inline [&>p]:my-0", className)}
          {...props}
        >
          <span className="flex items-start gap-2">
            <span className="mt-[3px] flex-none">{check}</span>
            <span className="min-w-0 flex-1">{rest}</span>
          </span>
        </li>
      );
    }
  }
  return (
    <li
      data-streamdown="list-item"
      className={cn("py-1 pl-1 [&>p]:inline [&>p]:my-0", className)}
      {...props}
    >
      {children}
    </li>
  );
}

/* Pulls the task checkbox out of the item's children so the item can
 * render as a row: the box first, then the text and any nested list.
 * Wrapped lines stay inside the text cell, so they hang under the first
 * line instead of falling back under the checkbox. The native bullet is
 * untouched — the row is a plain child of the list item.
 *
 * The checkbox arrives either as a direct child of the item or as the
 * first child of its leading paragraph; both shapes come from the same
 * remark output. Anything else (a streaming partial with no box yet)
 * returns no check and renders through the normal path. */
function splitTaskItem(children: ReactNode): {
  check?: ReactNode;
  rest: ReactNode[];
} {
  const rest: ReactNode[] = [];
  let check: ReactNode | undefined;
  for (const kid of Children.toArray(children)) {
    if (!check && isValidElement(kid) && kid.type === MarkdownInput) {
      check = kid;
      continue;
    }
    if (
      !check &&
      isValidElement<{
        children?: ReactNode;
      }>(kid) &&
      kid.type === TableParagraphComponent
    ) {
      const inner = Children.toArray(
        (kid.props as { children?: ReactNode }).children,
      );
      const [first, ...after] = inner;
      if (
        first &&
        isValidElement(first) &&
        (first as { type?: unknown }).type === MarkdownInput
      ) {
        check = first;
        rest.push(...after);
        continue;
      }
    }
    rest.push(kid);
  }
  return { check, rest };
}

/* Task-list checkbox. GFM emits a native disabled `<input>`, which renders
 * as a flat grey box, and it sits beside the bullet so each item shows two
 * markers. This replaces it with a static glyph in the product's checkbox
 * language (see `.records-checkbox-box`): same border, radius, and accent
 * fill, sized for 14px reply text. The bullet stays — the item renders as
 * a row with the box first and the text in its own cell, so wrapped lines
 * hang under the item text. */
function MarkdownInput({
  type,
  checked,
  node: _node,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { node?: unknown }) {
  void _node;
  if (type === "checkbox") {
    const isChecked = checked === true;
    return (
      <span
        role="img"
        aria-label={isChecked ? "Completed" : "Not completed"}
        data-md-task-check=""
        data-checked={isChecked ? "true" : "false"}
        className="md-task-check"
      >
        {isChecked ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        ) : null}
      </span>
    );
  }
  return <input type={type} checked={checked} disabled readOnly {...props} />;
}

export type MarkdownBodyProps = {
  /** the text part(s) being rendered, exactly as the model wrote them */
  children: string;
  /** true while this part is still streaming */
  isAnimating?: boolean;
  /** blink a caret at the end of the newest block while streaming */
  caret?: boolean;
  className?: string;
  /** streamdown element overrides, passed straight through */
  components?: Components;
  /** math plugin; omitted on the plain path so KaTeX stays out of the bundle */
  math?: MathPlugin;
};

/* MarkdownBody — the assistant's reply.
 *
 * Text parts stream in as markdown and render through Streamdown, which
 * completes unterminated syntax while a reply is still arriving, so a
 * half-open bold or code fence renders instead of flashing or breaking.
 * The root carries the reply typography, which the paragraphs inherit,
 * because streamdown leaves them unstyled on purpose.
 */
export function MarkdownBody({
  children,
  isAnimating = false,
  caret = false,
  className,
  components,
  math,
}: MarkdownBodyProps) {
  const remarkPlugins = useMemo(
    () => [...Object.values(defaultRemarkPlugins), remarkMark],
    [],
  );

  const streamdownPlugins = useMemo(
    () => (math ? { math, renderers: [peleRenderer] } : { renderers: [peleRenderer] }),
    [math],
  );

  /* Titles keyed by table content, parsed from the same source Streamdown
   * renders. Read-only: TableWrapper looks titles up, never writes. */
  const titleMap = useMemo(() => buildTableTitleMap(children), [children]);

  const mergedComponents = useMemo(
    () => ({
      a: MarkdownLink,
      code: MarkdownCode,
      mark: MarkdownMark,
      asset: AssetPill,
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
      ul: MarkdownUl,
      ol: MarkdownOl,
      li: MarkdownLi,
      input: MarkdownInput,
      ...components,
    }),
    [components],
  );

  return (
    <TableTitleMapContext.Provider value={titleMap}>
      <Streamdown
        plugins={streamdownPlugins}
        remarkPlugins={remarkPlugins}
        /* `asset` is a deliberate inline marker, not text detection. Streamdown
         * leaves it literal inside code spans and fences because rehype-raw
         * does not parse code as HTML. */
        allowedTags={{ mark: [], asset: ["symbol", "chain"] }}
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
    </TableTitleMapContext.Provider>
  );
}
