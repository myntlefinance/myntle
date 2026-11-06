import type { ReactNode } from "react";

/** Flattens rendered React children to the text a reader sees. Used where a
 * markdown block's own text decides layout or a custom element's label. */
export function extractChildrenText(children: ReactNode): string {
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
