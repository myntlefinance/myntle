/* Table titles derived at parse time.
 *
 * A heading, a `table: NAME` (or `[NAME]`) paragraph, or a lone bold
 * paragraph introduces the table that follows it. MarkdownBody parses its
 * source once per render, pairs each table with its pending title, and
 * shares the pairs through context as read-only data — so no component
 * mutates shared state during render to pass a title sideways.
 *
 * Tables are keyed by their cell text, which is identical on the mdast
 * side (this map) and the hast side (TableWrapper's node): GFM parsing
 * decodes entities and strips cell padding on both. Two byte-identical
 * tables share a key; the first title wins, matching document order.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm as micromarkGfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";

type TableTextNode = {
  type?: string;
  value?: string;
  tagName?: string;
  children?: TableTextNode[];
};

const TABLE_PREFIX_RE = /^(?:table\s*[:\-]\s*|\[)(.+?)(?:\])?$/i;

/* Visible text of a node, mirroring extractChildrenText on the rendered
 * side: text and code values verbatim, inline html tag-stripped, everything
 * else recursed. Nodes without text or children (images, breaks) read as
 * empty, same as their rendered elements. Works on mdast and hast nodes,
 * which share this shape. */
export function visibleText(node: TableTextNode): string {
  if (typeof node.value === "string" && !Array.isArray(node.children)) {
    return node.type === "html"
      ? node.value.replace(/<[^>]*>/g, "")
      : node.value;
  }
  if (!Array.isArray(node.children)) return "";
  return node.children.map(visibleText).join("");
}

/* The pending title a paragraph sets: a string for a title paragraph,
 * null for a plain one (which clears whatever came before). */
function paragraphTitle(node: TableTextNode): string | null {
  const text = visibleText(node).trim();
  const prefixed = text.match(TABLE_PREFIX_RE);
  if (prefixed) return prefixed[1].trim();
  const singleStrong =
    Array.isArray(node.children) &&
    node.children.length === 1 &&
    node.children[0]?.type === "strong";
  if (singleStrong && text.length > 0 && text.length < 80) return text;
  return null;
}

function tableCells(node: TableTextNode): string[][] {
  const rows: string[][] = [];
  const pushRow = (row: TableTextNode) => {
    if (!Array.isArray(row.children)) return;
    const cells: string[] = [];
    for (const cell of row.children) {
      if (!cell || typeof cell !== "object") continue;
      if (
        cell.type === "tableCell" ||
        cell.tagName === "th" ||
        cell.tagName === "td"
      ) {
        cells.push(visibleText(cell));
      }
    }
    rows.push(cells);
  };
  if (!Array.isArray(node.children)) return rows;
  for (const child of node.children) {
    if (!child || typeof child !== "object") continue;
    if (child.type === "tableRow" || child.tagName === "tr") {
      pushRow(child);
    } else if (
      child.tagName === "thead" ||
      child.tagName === "tbody" ||
      child.tagName === "tfoot"
    ) {
      if (Array.isArray(child.children)) {
        for (const row of child.children) {
          if (row && typeof row === "object") pushRow(row);
        }
      }
    }
  }
  return rows;
}

/** Content key shared by the map side (mdast) and the lookup side (hast). */
export function tableContentKey(node: TableTextNode): string {
  return JSON.stringify(tableCells(node));
}

function walk(node: TableTextNode, state: { pending: string | null; map: Map<string, string> }): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "heading") {
    const text = visibleText(node).trim();
    if (text) state.pending = text;
  } else if (node.type === "paragraph") {
    state.pending = paragraphTitle(node);
  } else if (node.type === "table") {
    if (state.pending) {
      const key = tableContentKey(node);
      if (!state.map.has(key)) state.map.set(key, state.pending);
    }
    state.pending = null;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, state);
  }
}

/* Pair every table in the source with its pending title, in document
 * order. A failed parse yields no titles rather than half a map: tables
 * fall back to their header-derived names, same as untitled tables. */
export function buildTableTitleMap(source: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  let tree: TableTextNode;
  try {
    tree = fromMarkdown(source, {
      extensions: [micromarkGfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as unknown as TableTextNode;
  } catch {
    return map;
  }
  walk(tree, { pending: null, map });
  return map;
}
