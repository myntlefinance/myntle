"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import CodeBlock from "@/components/primitives/CodeBlock";
import { PeleDiagram } from "@/components/app/PeleDiagram";

type HastNode = {
  properties?: {
    className?: string[];
    metastring?: string;
    [key: string]: unknown;
  };
};

export type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  node?: HastNode;
  "data-block"?: string | boolean;
  metastring?: string;
};

/**
 * Resolves a clean display filename from fence metastring or language extension.
 */
function resolveFilename(metastring?: string, language?: string): string {
  if (metastring) {
    const fnMatch = metastring.match(/(?:filename|title)=["']?([^"'\s]+)["']?/);
    if (fnMatch) return fnMatch[1];
    const firstWord = metastring.trim().split(/\s+/)[0];
    if (firstWord && (firstWord.includes(".") || firstWord.includes("/"))) {
      return firstWord;
    }
  }

  if (!language) return "code";

  const extMap: Record<string, string> = {
    typescript: "ts",
    javascript: "js",
    python: "py",
    rust: "rs",
    golang: "go",
    json: "json",
    html: "html",
    css: "css",
    markdown: "md",
    bash: "sh",
    shell: "sh",
    zsh: "sh",
    sql: "sql",
    diff: "diff",
  };

  const ext = extMap[language.toLowerCase()] ?? language.toLowerCase();
  return `snippet.${ext}`;
}

function extractCodeString(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children
      .map((c) => (typeof c === "string" ? c : ""))
      .join("");
  }
  return children ? String(children) : "";
}

/**
 * MarkdownCode replaces Streamdown's internal code card with Beautiful UI's CodeBlock primitive.
 * Fenced blocks render the unified CodeBlock with the programming language info pill,
 * while inline code renders as a clean monospace chip.
 */
export function MarkdownCode({
  node,
  className,
  children,
  "data-block": dataBlock,
  metastring,
  ...props
}: MarkdownCodeProps) {
  const isBlock = Boolean(dataBlock);

  // 1. Inline code: render clean monospace chip
  if (!isBlock) {
    return (
      <code
        className="rounded-md bg-inset px-1.5 py-0.5 font-mono text-[12.5px] text-ink-2 align-baseline"
        {...props}
      >
        {children}
      </code>
    );
  }

  // 2. Fenced code block: extract language, metastring, and raw code text
  const rawCode = extractCodeString(children);
  const langMatch = className?.match(/language-([\w-]+)/);
  const language = langMatch ? langMatch[1] : undefined;
  const meta = metastring ?? (node?.properties?.metastring as string | undefined);

  // If Mermaid diagram, delegate to PeleDiagram
  if (language === "mermaid") {
    return <PeleDiagram code={rawCode} language={language} meta={meta} />;
  }

  const filename = resolveFilename(meta, language);

  return (
    <CodeBlock
      code={rawCode}
      language={language}
      filename={filename}
      className="my-3"
    />
  );
}
