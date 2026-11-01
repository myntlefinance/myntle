"use client";

import {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  IconTable,
  IconCopy,
  IconCheck,
  IconDownload,
  IconMaximize,
  IconMinimize,
  IconChevronDown,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import GlideMenu from "@/components/primitives/GlideMenu";

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export type MarkdownTableProps = {
  children?: ReactNode;
  node?: HastNode;
  className?: string;
  title?: string;
  showCopy?: boolean;
  showDownload?: boolean;
  showFullscreen?: boolean;
  showRowNumbers?: boolean;
  showHeaderRow?: boolean;
};

type ColumnDef = {
  id: string;
  label: string;
  content: ReactNode;
  align?: "left" | "center" | "right";
  isNumeric?: boolean;
};

type CellDef = {
  id: string;
  rawText: string;
  content: ReactNode;
};

type RowDef = {
  id: string;
  originalIndex: number;
  cells: CellDef[];
};

/**
 * Extracts pure text recursively from React elements or primitives.
 */
function extractCellText(cell: ReactNode): string {
  if (cell == null) return "";
  if (typeof cell === "string" || typeof cell === "number") return String(cell);
  if (Array.isArray(cell)) return cell.map(extractCellText).join("");
  if (typeof cell === "object" && "props" in cell) {
    const props = (cell as { props?: { children?: ReactNode } }).props;
    if (props && "children" in props) {
      return extractCellText(props.children);
    }
  }
  return "";
}

/**
 * Unwraps any nested <td> or <th> elements (e.g. from Streamdown default components)
 * so they are never rendered inside RecordsTable's own <td> cells.
 */
function unwrapCellContent(content: ReactNode): ReactNode {
  if (content && typeof content === "object" && "props" in content) {
    const el = content as {
      type?: unknown;
      props?: { children?: ReactNode; "data-streamdown"?: string };
    };
    if (
      el.type === "td" ||
      el.type === "th" ||
      el.props?.["data-streamdown"] === "table-cell" ||
      el.props?.["data-streamdown"] === "table-header-cell"
    ) {
      return unwrapCellContent(el.props?.children);
    }
  }
  return content;
}

/**
 * Parses numeric and currency values safely. Returns null if not numeric.
 */
function parseNumeric(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  // Strip markdown emphasis, currency symbols, percentage, commas, and common tickers
  const stripped = trimmed
    .replace(/[*_~`]/g, "")
    .replace(/[$€£¥%,]/g, "")
    .replace(/\b(USD|USDT|USDC|EUR|GBP|NEAR|SOL|BTC|ETH)\b/gi, "")
    .trim();
  if (stripped === "" || isNaN(Number(stripped))) return null;
  return Number(stripped);
}

/**
 * Determines whether a column is predominantly numeric/currency data.
 */
function isNumericColumn(colIndex: number, rows: RowDef[]): boolean {
  if (rows.length === 0) return false;
  let numericCount = 0;
  let nonEmptyCount = 0;

  for (const row of rows) {
    const raw = row.cells[colIndex]?.rawText?.trim();
    if (!raw) continue;
    nonEmptyCount++;
    if (parseNumeric(raw) !== null) {
      numericCount++;
    }
  }

  return nonEmptyCount > 0 && numericCount / nonEmptyCount >= 0.6;
}

/**
 * Checks if the first column in the table is an existing row index column (e.g. #, No., Row).
 */
function isRowIndexColumn(headerLabel: string, rows: RowDef[]): boolean {
  const clean = headerLabel.trim().toLowerCase().replace(/[#.:]/g, "");
  if (!["", "no", "num", "number", "index", "row", "idx"].includes(clean)) {
    return false;
  }
  if (rows.length === 0) return true;
  return rows.every((r, i) => {
    const raw = r.cells[0]?.rawText?.trim().replace(/\.$/, "") || "";
    return raw === String(i + 1) || parseNumeric(raw) === i + 1;
  });
}

/**
 * Extracts a title or caption from the HAST table node if present.
 */
function extractTableCaption(node?: HastNode): string | undefined {
  if (!node) return undefined;
  if (typeof node.properties?.title === "string" && node.properties.title.trim()) {
    return node.properties.title.trim();
  }
  if (typeof node.properties?.name === "string" && node.properties.name.trim()) {
    return node.properties.name.trim();
  }
  if (node.children) {
    const captionNode = node.children.find((c) => c.tagName === "caption");
    if (captionNode) {
      const text = extractHastText(captionNode).trim();
      if (text) return text;
    }
  }
  return undefined;
}

function extractHastText(node?: HastNode): string {
  if (!node) return "";
  if (node.type === "text" && node.value) return node.value;
  if (node.children) return node.children.map(extractHastText).join("");
  return "";
}

/**
 * Parses Streamdown table children into structured column definitions and rows.
 */
function parseTableData(children: ReactNode, node?: HastNode): {
  headers: ColumnDef[];
  rows: RowDef[];
  captionTitle?: string;
} {
  const captionTitle = extractTableCaption(node);
  const childArray = Array.isArray(children) ? children : [children];

  let theadEl: ReactNode = null;
  let tbodyEl: ReactNode = null;

  for (const child of childArray) {
    if (!child || typeof child !== "object" || !("props" in child)) continue;
    const el = child as { props?: { node?: HastNode; children?: ReactNode } };
    const tagName = el.props?.node?.tagName;
    if (tagName === "thead") theadEl = child;
    else if (tagName === "tbody") tbodyEl = child;
  }

  if (!theadEl && childArray.length > 0) theadEl = childArray[0];
  if (!tbodyEl && childArray.length > 1) tbodyEl = childArray[1];

  // 1. Parse initial headers
  const initialHeaders: Omit<ColumnDef, "isNumeric">[] = [];
  if (theadEl && typeof theadEl === "object" && "props" in theadEl) {
    const theadProps = (theadEl as { props?: { children?: ReactNode } }).props;
    const trEl = theadProps?.children;
    if (trEl && typeof trEl === "object" && "props" in trEl) {
      const trProps = (trEl as { props?: { children?: ReactNode } }).props;
      const ths = Array.isArray(trProps?.children) ? trProps.children : [trProps?.children];
      ths.forEach((th, idx) => {
        if (!th) return;
        const thObj = typeof th === "object" && "props" in th ? (th as { props?: { node?: HastNode; align?: string; children?: ReactNode } }) : null;
        const content = thObj?.props?.children ?? th;
        const label = extractCellText(content).trim();
        const alignProp = thObj?.props?.align || (thObj?.props?.node?.properties?.align as string | undefined);
        const align = alignProp === "right" || alignProp === "center" || alignProp === "left" ? alignProp : undefined;

        initialHeaders.push({
          id: `col-${idx}`,
          label: label || `Column ${idx + 1}`,
          content,
          align,
        });
      });
    }
  }

  // 2. Parse data rows
  const rows: RowDef[] = [];
  if (tbodyEl && typeof tbodyEl === "object" && "props" in tbodyEl) {
    const tbodyProps = (tbodyEl as { props?: { children?: ReactNode } }).props;
    const trs = Array.isArray(tbodyProps?.children) ? tbodyProps.children : [tbodyProps?.children];
    trs.forEach((tr, rowIndex) => {
      if (!tr || typeof tr !== "object" || !("props" in tr)) return;
      const trProps = (tr as { props?: { children?: ReactNode } }).props;
      const tds = Array.isArray(trProps?.children) ? trProps.children : [trProps?.children];
      const cells: CellDef[] = tds.map((td, colIndex) => {
        const tdProps =
          td && typeof td === "object" && "props" in td
            ? (td as { props?: { children?: ReactNode } }).props
            : null;
        const content = unwrapCellContent(tdProps?.children ?? td);
        const rawText = extractCellText(content).trim();
        return {
          id: `cell-${rowIndex}-${colIndex}`,
          rawText,
          content,
        };
      });
      rows.push({
        id: `row-${rowIndex}`,
        originalIndex: rowIndex,
        cells,
      });
    });
  }

  // If the first column is already an index/row column (e.g. #, No., 1, 2...),
  // consume it so our sticky gutter column provides the unified RecordsTable row gutter
  if (initialHeaders.length > 0 && isRowIndexColumn(initialHeaders[0].label, rows)) {
    initialHeaders.shift();
    rows.forEach((r) => {
      r.cells.shift();
    });
  }

  // 3. Detect column numeric data types & establish alignment
  // Numbers (including currencies and percentages) should be right-aligned
  const headers: ColumnDef[] = initialHeaders.map((h, colIdx) => {
    const isNumeric = isNumericColumn(colIdx, rows);
    const align = isNumeric ? "right" : (h.align ?? "left");
    return {
      ...h,
      isNumeric,
      align,
    };
  });

  return { headers, rows, captionTitle };
}

/** Converts structured table data into CSV format */
function toCSV(headers: ColumnDef[], rows: RowDef[]): string {
  const escape = (val: string) => `"${val.replace(/"/g, '""')}"`;
  const headerLine = headers.map((h) => escape(h.label)).join(",");
  const rowLines = rows.map((r) =>
    headers.map((_, i) => escape(r.cells[i]?.rawText ?? "")).join(","),
  );
  return [headerLine, ...rowLines].join("\n");
}

/** Converts structured table data into TSV format (for spreadsheet pasting) */
function toTSV(headers: ColumnDef[], rows: RowDef[]): string {
  const clean = (val: string) => val.replace(/[\t\n\r]/g, " ");
  const headerLine = headers.map((h) => clean(h.label)).join("\t");
  const rowLines = rows.map((r) =>
    headers.map((_, i) => clean(r.cells[i]?.rawText ?? "")).join("\t"),
  );
  return [headerLine, ...rowLines].join("\n");
}

/** Converts structured table data into Markdown format */
function toMarkdown(headers: ColumnDef[], rows: RowDef[]): string {
  const clean = (val: string) => val.replace(/\|/g, "\\|").replace(/[\n\r]/g, " ");
  const headerLine = `| ${headers.map((h) => clean(h.label)).join(" | ")} |`;
  const separatorLine = `| ${headers.map((h) => (h.align === "right" ? "---:" : h.align === "center" ? ":---:" : "---")).join(" | ")} |`;
  const rowLines = rows.map(
    (r) => `| ${headers.map((_, i) => clean(r.cells[i]?.rawText ?? "")).join(" | ")} |`,
  );
  return [headerLine, separatorLine, ...rowLines].join("\n");
}

/** Triggers a browser file download */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * MarkdownTable replaces Streamdown's unstyled table component with
 * BeautifulUI's RecordsTable design foundation.
 */
export function MarkdownTable({
  children,
  node,
  className,
  title: explicitTitle,
  showCopy = true,
  showDownload = true,
  showFullscreen = true,
  showRowNumbers = true,
  showHeaderRow = true,
}: MarkdownTableProps) {
  const { headers, rows, captionTitle } = useMemo(
    () => parseTableData(children, node),
    [children, node],
  );

  const smartFallbackTitle = useMemo(() => {
    const labels = headers.map((h) => h.label.toLowerCase());
    if (
      labels.some(
        (l) =>
          l.includes("balance") ||
          l.includes("amount") ||
          l.includes("holding"),
      )
    ) {
      return "Asset Balances";
    }
    if (
      labels.some(
        (l) =>
          l.includes("price") || l.includes("rate") || l.includes("quote"),
      )
    ) {
      return "Market Rates";
    }
    if (
      labels.some(
        (l) => l.includes("tx") || l.includes("hash") || l.includes("trade"),
      )
    ) {
      return "Transaction History";
    }
    return "Table";
  }, [headers]);

  const displayTitle = explicitTitle || captionTitle || smartFallbackTitle;

  // Sorting state
  const [sort, setSort] = useState<{ colIndex: number | null; dir: 1 | -1 }>({
    colIndex: null,
    dir: 1,
  });

  // Column widths state
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [resizingCol, setResizingCol] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  // Helper menu states
  const [copied, setCopied] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const copyMenuRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    if (!copyMenuOpen && !downloadMenuOpen) return;
    const handlePointerDown = (e: MouseEvent | PointerEvent | globalThis.PointerEvent) => {
      const target = e.target as Node;
      if (copyMenuRef.current && !copyMenuRef.current.contains(target)) {
        setCopyMenuOpen(false);
      }
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(target)) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [copyMenuOpen, downloadMenuOpen]);

  // Fullscreen escape key dismiss
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // Robust numeric and alphabetical sorting
  const sortedRows = useMemo(() => {
    if (sort.colIndex === null) return rows;
    const colIdx = sort.colIndex;
    const dir = sort.dir;

    return [...rows].sort((a, b) => {
      const valA = a.cells[colIdx]?.rawText ?? "";
      const valB = b.cells[colIdx]?.rawText ?? "";

      const numA = parseNumeric(valA);
      const numB = parseNumeric(valB);

      // If both values are valid numbers/currencies, sort numerically
      if (numA !== null && numB !== null) {
        return (numA - numB) * dir;
      }
      // If one is numeric and the other is empty/text, numeric values sort higher
      if (numA !== null) return -1 * dir;
      if (numB !== null) return 1 * dir;

      // Otherwise fall back to localeCompare
      return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, sort]);

  const toggleSort = (colIndex: number) => {
    setSort((prev) => {
      if (prev.colIndex === colIndex) {
        if (prev.dir === 1) return { colIndex, dir: -1 };
        return { colIndex: null, dir: 1 };
      }
      return { colIndex, dir: 1 };
    });
  };

  // Column resize handler
  const startColumnResize = (colIndex: number) => (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const th = (e.currentTarget as Element).closest("th");
    const startWidth = th ? th.getBoundingClientRect().width : (columnWidths[colIndex] ?? 120);
    const startX = e.clientX;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizingCol(colIndex);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const minW = headers[colIndex]?.isNumeric ? 64 : 80;
      const newWidth = Math.max(minW, Math.round(startWidth + delta));
      setColumnWidths((prev) => ({ ...prev, [colIndex]: newWidth }));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      setResizingCol(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Copy handler
  const handleCopy = useCallback(
    (format: "tsv" | "md" | "csv" = "tsv") => {
      let content = "";
      if (format === "csv") content = toCSV(headers, sortedRows);
      else if (format === "md") content = toMarkdown(headers, sortedRows);
      else content = toTSV(headers, sortedRows);

      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        setCopyMenuOpen(false);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [headers, sortedRows],
  );

  // Download handler
  const handleDownload = useCallback(
    (format: "csv" | "md") => {
      const safeFilename = displayTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "table";
      if (format === "csv") {
        downloadFile(toCSV(headers, sortedRows), `${safeFilename}.csv`, "text/csv;charset=utf-8;");
      } else {
        downloadFile(
          toMarkdown(headers, sortedRows),
          `${safeFilename}.md`,
          "text/markdown;charset=utf-8;",
        );
      }
      setDownloadMenuOpen(false);
    },
    [headers, sortedRows, displayTitle],
  );

  // Fallback if empty table
  if (headers.length === 0 && rows.length === 0) {
    return (
      <div className={cn("records-shell my-3", className)}>
        <table className="records-table !min-w-0 w-full">{children}</table>
      </div>
    );
  }

  // Analyze content dimensions across all rows to determine proportional weights and minimum readable widths
  const columnMetrics = useMemo(() => {
    return headers.map((col, colIdx) => {
      let maxLen = col.label.length;
      for (const row of rows) {
        const text = row.cells[colIdx]?.rawText?.trim() || "";
        if (text.length > maxLen) maxLen = text.length;
      }
      const isShortTicker = !col.isNumeric && maxLen <= 6;

      // Minimum readable pixel width
      const minNaturalWidth = col.isNumeric
        ? Math.max(76, Math.min(130, Math.round(maxLen * 8.5 + 36)))
        : isShortTicker
          ? Math.max(70, Math.min(100, Math.round(maxLen * 8.5 + 36)))
          : Math.max(110, Math.min(260, Math.round(maxLen * 8.5 + 36)));

      // Content weight for proportional percentage distribution
      const weight = col.isNumeric
        ? Math.max(col.label.length + 3, maxLen, 8)
        : isShortTicker
          ? Math.max(col.label.length, maxLen, 7)
          : Math.max(col.label.length, maxLen, 12);

      return {
        maxLen,
        isNumeric: col.isNumeric,
        isShortTicker,
        minNaturalWidth,
        weight,
      };
    });
  }, [headers, rows]);

  // Compute column styling: explicit px if resized, proportional percentage if not
  const columnStyles = useMemo(() => {
    const unresizedWeights = headers.reduce((sum, _, idx) => {
      return columnWidths[idx] ? sum : sum + (columnMetrics[idx]?.weight || 10);
    }, 0);

    return headers.map((_, idx) => {
      const explicitWidth = columnWidths[idx];
      if (explicitWidth) {
        return {
          colWidth: `${explicitWidth}px`,
          minWidth: `${explicitWidth}px`,
        };
      }
      const weight = columnMetrics[idx]?.weight || 10;
      const pct =
        unresizedWeights > 0
          ? ((weight / unresizedWeights) * 100).toFixed(1)
          : (100 / Math.max(1, headers.length)).toFixed(1);
      const minW = columnMetrics[idx]?.minNaturalWidth || 80;

      return {
        colWidth: `${pct}%`,
        minWidth: `${minW}px`,
      };
    });
  }, [headers, columnWidths, columnMetrics]);

  // Render the core table grid
  const renderTableGrid = (isFull: boolean) => (
    <div
      className={cn(
        "records-scroll [scrollbar-gutter:auto]",
        isFull ? "flex-1 min-h-0 w-full overflow-auto" : "max-h-[460px] overflow-auto",
      )}
      tabIndex={0}
      aria-label={`${displayTitle} data table`}
    >
      <table className="records-table w-full border-collapse [&_th.is-colsel]:[box-shadow:none] [&_th.is-colsel]:shadow-none">
        {/* Column widths: compact for gutter, proportional for data columns */}
        <colgroup>
          {/* Row number gutter: strictly 44px */}
          {showRowNumbers && <col style={{ width: 44, minWidth: 44, maxWidth: 44 }} />}
          {headers.map((col, idx) => (
            <col
              key={col.id}
              style={{
                width: columnStyles[idx].colWidth,
                minWidth: columnStyles[idx].minWidth,
              }}
            />
          ))}
        </colgroup>

        {/* Table Header */}
        {showHeaderRow && (
          <thead>
            <tr>
              {/* Row number gutter header: centered, strictly no padding, no overflow, no ellipsis dot */}
              {showRowNumbers && (
                <th className="records-header-cell records-sticky-cell w-11 text-center font-medium text-[11.5px] text-ink-3 select-none !p-0 !overflow-visible !text-clip">
                  <div className="flex h-[35px] w-full items-center justify-center">
                    No.
                  </div>
                </th>
              )}

              {/* Data Column Headers */}
            {headers.map((col, idx) => {
              const isColActive = hoveredCol === idx;
              const isSorted = sort.colIndex === idx;
              const isRight = col.align === "right";

              return (
                <th
                  key={col.id}
                  className={cn(
                    "records-header-cell relative select-none [&.is-colsel]:[box-shadow:none] [&.is-colsel]:shadow-none",
                    isColActive && "is-colsel",
                  )}
                  style={{
                    width: columnStyles[idx].colWidth,
                    minWidth: columnStyles[idx].minWidth,
                    textAlign: isRight ? "right" : "left",
                  }}
                  onMouseEnter={() => setHoveredCol(idx)}
                  onMouseLeave={() => setHoveredCol(null)}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(idx)}
                    style={{ textAlign: isRight ? "right" : "left" }}
                    className={cn(
                      "records-header-button flex h-[35px] w-full items-center gap-1.5 px-2.5 font-medium text-[12.5px] text-ink-2 hover:text-ink transition-colors",
                      isRight ? "is-right justify-end !text-right flex-row" : "justify-start !text-left",
                    )}
                  >
                    {/* For right-aligned columns, chevron appears first on the left, keeping label flush right */}
                    {isRight && (
                      <span
                        className={cn(
                          "records-sort !ml-0 !mr-1 inline-flex items-center text-ink-3 transition-transform duration-160 shrink-0",
                          isSorted ? "is-visible opacity-100" : "opacity-0 hover:opacity-100",
                        )}
                        style={{
                          transform: isSorted && sort.dir === -1 ? "rotate(180deg)" : undefined,
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12l7 7 7-7" />
                        </svg>
                      </span>
                    )}
                    <span className={cn("truncate", isRight && "!text-right text-right")}>{col.content}</span>
                    {!isRight && (
                      <span
                        className={cn(
                          "records-sort !ml-auto inline-flex items-center text-ink-3 transition-transform duration-160 shrink-0",
                          isSorted ? "is-visible opacity-100" : "opacity-0 hover:opacity-100",
                        )}
                        style={{
                          transform: isSorted && sort.dir === -1 ? "rotate(180deg)" : undefined,
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12l7 7 7-7" />
                        </svg>
                      </span>
                    )}
                  </button>

                  {/* Draggable Column Resize Handle: only between adjacent columns, never on the last column */}
                  {idx < headers.length - 1 && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${col.label} column`}
                      className={cn(
                        "records-resize-handle",
                        resizingCol === idx && "is-resizing",
                      )}
                      onPointerDown={startColumnResize(idx)}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        )}

        {/* Table Body */}
        <tbody data-sound-silent>
          {sortedRows.map((row, rowIdx) => (
            <tr key={row.id} className="records-row group">
              {/* Row number cell: strictly centered, 0 padding, overflow visible, no ellipsis dots */}
              {showRowNumbers && (
                <td className="records-cell records-sticky-cell text-center select-none !p-0 !overflow-visible !text-clip">
                  <span className="records-rownum !w-full !h-full !inline-flex items-center justify-center font-medium text-[11.5px] text-ink-3 !overflow-visible">
                    {rowIdx + 1}
                  </span>
                </td>
              )}

              {/* Data cells */}
              {headers.map((col, colIdx) => {
                const cell = row.cells[colIdx];
                const isColSel = hoveredCol === colIdx;
                const isRight = col.align === "right";

                return (
                  <td
                    key={cell?.id ?? `empty-${rowIdx}-${colIdx}`}
                    className={cn(
                      "records-cell px-2.5 text-[13px] font-medium text-ink",
                      isRight ? "!text-right text-right tabular-nums [&_*]:!text-right" : "!text-left text-left",
                      isColSel && "is-colsel",
                      !cell?.rawText && "records-muted",
                    )}
                    style={{ textAlign: isRight ? "right" : "left" }}
                    onMouseEnter={() => setHoveredCol(colIdx)}
                    onMouseLeave={() => setHoveredCol(null)}
                  >
                    {cell ? (
                      unwrapCellContent(cell.content) ||
                      cell.rawText || (
                        <span className="records-muted">—</span>
                      )
                    ) : (
                      <span className="records-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // The toolbar header bar
  const renderHeaderBar = (isFull: boolean) => (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3 text-[12.5px] select-none flex-nowrap bg-surface">
      {/* Left: Table Icon + Title */}
      <div className="flex min-w-0 items-center gap-2 shrink truncate">
        <IconTable size={15} stroke={1.8} className="shrink-0 text-accent-ink" />
        <span className="truncate font-medium leading-none text-ink">{displayTitle}</span>
      </div>

      {/* Right: Actions (Copy, Download, Fullscreen) */}
      {(showCopy || showDownload || showFullscreen) && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0 flex-nowrap">
          {/* Unified Segmented Copy Pill: Prevents Chevron Wrapping */}
          {showCopy && (
            <div
              ref={copyMenuRef}
              className="relative inline-flex items-center rounded-[6px] border border-line bg-surface hover:bg-hover transition-colors shrink-0 whitespace-nowrap"
            >
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy table"}
            onClick={() => handleCopy("tsv")}
            className={cn(
              "flex h-7 items-center gap-1.5 px-2 text-[12px] font-medium transition-colors shrink-0",
              copied ? "text-green" : "text-ink-2 hover:text-ink",
            )}
          >
            <span className="relative flex size-3.5 shrink-0 items-center justify-center">
              <span
                aria-hidden={copied}
                className="absolute inset-0 flex items-center justify-center transition-all duration-200"
                style={{
                  opacity: copied ? 0 : 1,
                  transform: copied ? "scale(0.8)" : "scale(1)",
                }}
              >
                <IconCopy size={13} stroke={1.8} />
              </span>
              <span
                aria-hidden={!copied}
                className="absolute inset-0 flex items-center justify-center text-green transition-all duration-200"
                style={{
                  opacity: copied ? 1 : 0,
                  transform: copied ? "scale(1)" : "scale(0.8)",
                }}
              >
                <IconCheck size={13} stroke={2.4} />
              </span>
            </span>
            {/* Sliding text: Copied slides up from bottom */}
            <span className="relative h-4 w-[40px] shrink-0 overflow-hidden text-left">
              <span
                aria-hidden={copied}
                className="absolute inset-0 flex items-center transition-all duration-200"
                style={{
                  opacity: copied ? 0 : 1,
                  transform: copied ? "translateY(-6px)" : "translateY(0)",
                }}
              >
                Copy
              </span>
              <span
                aria-hidden={!copied}
                className="absolute inset-0 flex items-center text-green font-medium transition-all duration-200"
                style={{
                  opacity: copied ? 1 : 0,
                  transform: copied ? "translateY(0)" : "translateY(6px)",
                }}
              >
                Copied
              </span>
            </span>
          </button>

          <div className="h-3.5 w-px bg-line shrink-0" />

          <button
            type="button"
            aria-label="Copy format options"
            onClick={() => setCopyMenuOpen((prev) => !prev)}
            className="flex h-7 w-5 items-center justify-center text-ink-3 hover:text-ink shrink-0 transition-colors"
          >
            <IconChevronDown size={11} stroke={2} />
          </button>

          {copyMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-1.5 w-40 rounded-[10px] bg-surface p-1 shadow-overlay border border-line"
              style={{
                animation: "pop-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
                transformOrigin: "top right",
              }}
            >
              <GlideMenu className="flex flex-col gap-0.5">
                <button
                  data-menu-row
                  type="button"
                  onClick={() => handleCopy("tsv")}
                  className="relative z-10 flex h-7.5 w-full items-center rounded-[6px] px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover active:scale-[0.97]"
                >
                  Copy for Sheets
                </button>
                <button
                  data-menu-row
                  type="button"
                  onClick={() => handleCopy("md")}
                  className="relative z-10 flex h-7.5 w-full items-center rounded-[6px] px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover active:scale-[0.97]"
                >
                  Copy Markdown
                </button>
                <button
                  data-menu-row
                  type="button"
                  onClick={() => handleCopy("csv")}
                  className="relative z-10 flex h-7.5 w-full items-center rounded-[6px] px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover active:scale-[0.97]"
                >
                  Copy CSV
                </button>
              </GlideMenu>
            </div>
          )}
        </div>
        )}

        {/* Download Dropdown */}
        {showDownload && (
          <div ref={downloadMenuRef} className="relative inline-flex items-center shrink-0">
          <button
            type="button"
            aria-label="Download table"
            onClick={() => setDownloadMenuOpen((prev) => !prev)}
            className="flex h-7 items-center gap-1.5 rounded-[6px] border border-line bg-surface hover:bg-hover px-2 text-[12px] font-medium text-ink-2 hover:text-ink transition-colors shrink-0 whitespace-nowrap"
          >
            <IconDownload size={13} stroke={1.8} />
            <span>Download</span>
            <IconChevronDown size={11} stroke={2} className="text-ink-3" />
          </button>

          {downloadMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-1.5 w-38 rounded-[10px] bg-surface p-1 shadow-overlay border border-line"
              style={{
                animation: "pop-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
                transformOrigin: "top right",
              }}
            >
              <GlideMenu className="flex flex-col gap-0.5">
                <button
                  data-menu-row
                  type="button"
                  onClick={() => handleDownload("csv")}
                  className="relative z-10 flex h-7.5 w-full items-center rounded-[6px] px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover active:scale-[0.97]"
                >
                  Download CSV
                </button>
                <button
                  data-menu-row
                  type="button"
                  onClick={() => handleDownload("md")}
                  className="relative z-10 flex h-7.5 w-full items-center rounded-[6px] px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover active:scale-[0.97]"
                >
                  Download Markdown
                </button>
              </GlideMenu>
            </div>
          )}
        </div>
        )}

        {/* Fullscreen Toggle */}
        {showFullscreen && (
          <button
            type="button"
            aria-label={isFull ? "Exit full screen" : "Full screen"}
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-line bg-surface hover:bg-hover text-ink-3 hover:text-ink transition-colors shrink-0 active:scale-[0.96]"
          >
            {isFull ? <IconMinimize size={13} stroke={1.8} /> : <IconMaximize size={13} stroke={1.8} />}
          </button>
        )}
      </div>
      )}
    </div>
  );

  // Fullscreen: Occupies 100% of the viewport (no outer padding, no max-width)
  if (isFullscreen && typeof document !== "undefined") {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${displayTitle} fullscreen view`}
        className="fixed inset-0 z-[100] flex h-screen w-screen flex-col bg-surface overflow-hidden"
      >
        {renderHeaderBar(true)}
        {renderTableGrid(true)}
      </div>,
      document.body,
    );
  }

  // Standard inline chat presentation
  return (
    <div
      ref={tableContainerRef}
      className={cn("records-shell w-full my-3 overflow-hidden", className)}
    >
      {renderHeaderBar(false)}
      {renderTableGrid(false)}
    </div>
  );
}
