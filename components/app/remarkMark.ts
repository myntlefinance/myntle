/* remark plugin for ==highlight==.
 *
 * Turns ==text== inside normal prose into a `mark` node
 * (rendered as <mark>). Skips code, math, links' URLs, and
 * frontmatter — only visible text nodes are rewritten.
 * An unclosed == is left alone so streaming stays literal
 * until the closing == arrives.
 */

type TextNode = { type: "text"; value: string };
type ParentNode = {
  type: string;
  children?: unknown[];
  value?: string;
};

const MARK_RE = /==([^=\n]+?)==/g;

const SKIP_PARENTS = new Set([
  "code",
  "inlineCode",
  "inlineMath",
  "math",
  "html",
  "definition",
]);

function splitText(value: string): (TextNode | unknown)[] | null {
  if (!value.includes("==")) return null;
  MARK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let found = false;
  const out: (TextNode | unknown)[] = [];
  while ((match = MARK_RE.exec(value)) !== null) {
    found = true;
    const start = match.index;
    if (start > lastIndex) {
      out.push({ type: "text", value: value.slice(lastIndex, start) });
    }
    out.push({
      type: "mark",
      data: { hName: "mark" },
      children: [{ type: "text", value: match[1] }],
    });
    lastIndex = start + match[0].length;
  }
  if (!found) return null;
  if (lastIndex < value.length) {
    out.push({ type: "text", value: value.slice(lastIndex) });
  }
  return out;
}

function walk(node: ParentNode): void {
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as ParentNode & { value?: string };
    if (!child || typeof child !== "object") continue;
    if (child.type === "text" && typeof child.value === "string") {
      if (SKIP_PARENTS.has(node.type)) continue;
      const split = splitText(child.value);
      if (split) {
        children.splice(i, 1, ...split);
        i += split.length - 1;
      }
      continue;
    }
    if (Array.isArray(child.children)) {
      if (SKIP_PARENTS.has(child.type)) continue;
      walk(child);
    }
  }
}

export function remarkMark() {
  return (tree: ParentNode) => {
    walk(tree);
  };
}
