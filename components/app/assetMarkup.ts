import { fromMarkdown } from "mdast-util-from-markdown";

type MarkdownNode = {
  type?: string;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  children?: MarkdownNode[];
};

const ASSET_PAIR = /<asset\b([^>]*)>([\s\S]*?)<\/asset\s*>/gi;
const ASSET_VOID = /<asset\b([^>]*?)\/>/gi;
const ASSET_OPEN = /<asset\b[^>]*>/gi;

function symbolFromAttrs(attrs: string): string {
  const double = /\bsymbol\s*=\s*"([^"]*)"/i.exec(attrs);
  const single = /\bsymbol\s*=\s*'([^']*)'/i.exec(attrs);
  const bare = /\bsymbol\s*=\s*([^\s>]+)/i.exec(attrs);
  return (double?.[1] ?? single?.[1] ?? bare?.[1] ?? "").trim();
}

function stripTags(text: string): string {
  return text
    .replace(ASSET_PAIR, (_match, attrs: string, content: string) => {
      const body = content.trim();
      return body || symbolFromAttrs(attrs);
    })
    .replace(ASSET_VOID, (_match, attrs: string) => symbolFromAttrs(attrs))
    .replace(ASSET_OPEN, "");
}

function collectCodeRanges(
  node: MarkdownNode,
  ranges: Array<[number, number]>,
): void {
  if (
    (node.type === "code" || node.type === "inlineCode") &&
    node.position?.start?.offset != null &&
    node.position?.end?.offset != null
  ) {
    ranges.push([node.position.start.offset, node.position.end.offset]);
    return;
  }
  for (const child of node.children ?? []) {
    collectCodeRanges(child, ranges);
  }
}

/** Removes the <asset> marker from copyable prose while leaving code alone.
 *
 * The tag is presentation, not part of the sentence, so the copy button and
 * share sheet must not carry it. Code spans and fences are protected first:
 * a tag shown as code is content, not markup. */
export function stripAssetMarkup(markdown: string): string {
  if (!markdown.includes("<asset")) return markdown;

  let tree: MarkdownNode;
  try {
    tree = fromMarkdown(markdown) as MarkdownNode;
  } catch {
    return stripTags(markdown);
  }

  const ranges: Array<[number, number]> = [];
  collectCodeRanges(tree, ranges);
  if (ranges.length === 0) return stripTags(markdown);

  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  const saved: string[] = [];

  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    out += markdown.slice(cursor, start);
    const token = `\u0000ASSET_CODE_${saved.length}\u0000`;
    saved.push(markdown.slice(start, end));
    out += token;
    cursor = end;
  }
  out += markdown.slice(cursor);

  return stripTags(out).replace(
    /\u0000ASSET_CODE_(\d+)\u0000/g,
    (_match, index: string) => saved[Number(index)] ?? "",
  );
}
