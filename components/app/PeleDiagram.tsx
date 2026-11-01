"use client";

import { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { render, PeleError } from "pele";
import {
  IconCopy,
  IconCheck,
  IconChartDots,
  IconMaximize,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type PeleDiagramProps = {
  code: string;
  isIncomplete?: boolean;
  language?: string;
  meta?: string;
};

/**
 * PeleDiagram renders Mermaid diagram syntax through Pele (obsidianmd/pele)
 * into native themeable SVGs with preview/code tabs and fullscreen expand capabilities.
 */
export function PeleDiagram({ code, isIncomplete = false }: PeleDiagramProps) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isWheeling, setIsWheeling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smooth height animation refs & states when switching between preview and code
  const figureRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const anchorTopRef = useRef<number | null>(null);
  const [currentHeight, setCurrentHeight] = useState<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleTabChange = useCallback(
    (nextTab: "preview" | "code") => {
      if (nextTab === tab) return;
      const figure = figureRef.current;
      if (containerRef.current && figure) {
        // Find ancestor scroll container (chat thread) and record initial viewport top position
        const scrollContainer = figure.closest(".overflow-y-auto") as HTMLElement | null;
        scrollContainerRef.current = scrollContainer;
        if (scrollContainer) {
          anchorTopRef.current = figure.getBoundingClientRect().top;
        }
        setCurrentHeight(containerRef.current.offsetHeight);
        setIsTransitioning(true);
      }
      setTab(nextTab);
    },
    [tab],
  );

  useLayoutEffect(() => {
    if (!isTransitioning || !innerRef.current) return;
    const nextH = innerRef.current.offsetHeight;
    if (currentHeight !== null && nextH === currentHeight) {
      setIsTransitioning(false);
      setCurrentHeight(null);
      return;
    }
    const raf = requestAnimationFrame(() => {
      setCurrentHeight(nextH);
    });
    return () => cancelAnimationFrame(raf);
  }, [tab, isTransitioning, currentHeight]);

  // Maintain the diagram's exact screen position during height transitions so the top stays fixed
  useLayoutEffect(() => {
    if (!isTransitioning) {
      anchorTopRef.current = null;
      return;
    }

    const figure = figureRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!figure || !scrollContainer || anchorTopRef.current === null) return;

    let animId: number;
    const maintainAnchor = () => {
      if (anchorTopRef.current !== null && figure && scrollContainer) {
        const currentTop = figure.getBoundingClientRect().top;
        const diff = currentTop - anchorTopRef.current;
        if (Math.abs(diff) >= 0.5) {
          scrollContainer.scrollTop += diff;
        }
      }
      animId = requestAnimationFrame(maintainAnchor);
    };

    animId = requestAnimationFrame(maintainAnchor);
    return () => cancelAnimationFrame(animId);
  }, [isTransitioning]);

  // Fallback safety in case onTransitionEnd does not fire
  useEffect(() => {
    if (!isTransitioning) return;
    const timer = setTimeout(() => {
      setIsTransitioning(false);
      setCurrentHeight(null);
    }, 350);
    return () => clearTimeout(timer);
  }, [isTransitioning]);

  // Fullscreen pan dragging handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOriginRef.current = { ...panRef.current };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors
      }
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isPanning) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      const nextPan = {
        x: panOriginRef.current.x + dx,
        y: panOriginRef.current.y + dy,
      };
      panRef.current = nextPan;
      setPan(nextPan);
    },
    [isPanning],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setIsPanning(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  // Mouse wheel zoom in fullscreen canvas anchored at mouse cursor
  useEffect(() => {
    if (!fullscreen) {
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
      setIsWheeling(false);
      setIsPanning(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const canvasEl = canvasRef.current;
      if (!canvasEl) return;

      // Temporarily disable CSS transition during wheel interaction for instant cursor tracking
      setIsWheeling(true);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => {
        setIsWheeling(false);
      }, 140);

      // Normalize delta depending on deltaMode (0: pixels, 1: lines, 2: pages)
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 100;

      // Clamp delta to avoid huge jumps from fast wheel spins or high velocity trackpad gestures
      const clampedDelta = Math.max(-120, Math.min(120, delta));
      const zoomMultiplier = Math.exp(-clampedDelta * 0.0025);

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      const nextZoom = Math.min(5, Math.max(0.25, Math.round(currentZoom * zoomMultiplier * 100) / 100));
      if (nextZoom === currentZoom) return;

      // Canvas dimensions & cursor offset from the canvas center (which matches transform-origin)
      const rect = canvasEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const mx = e.clientX - centerX;
      const my = e.clientY - centerY;

      // Calculate new pan to keep the content point under the mouse cursor at the exact same screen location
      const ratio = nextZoom / currentZoom;
      const nextPan = {
        x: mx - (mx - currentPan.x) * ratio,
        y: my - (my - currentPan.y) * ratio,
      };

      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    };
  }, [fullscreen]);

  // Lock body scroll and register Escape listener when in fullscreen mode.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  const onCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [code]);

  const { svg, error, diagramType } = useMemo(() => {
    if (!code || !code.trim()) {
      return { svg: null, error: null, diagramType: null };
    }
    try {
      const result = render(code.trim());
      return { svg: result.svg, error: null, diagramType: result.type };
    } catch (err) {
      return {
        svg: null,
        error: err instanceof PeleError ? err.message : String(err),
        diagramType: null,
      };
    }
  }, [code]);

  /* Mid-stream: if syntax is still incomplete, show code with streaming pulse */
  if (isIncomplete && !svg) {
    return (
      <div className="pele-diagram my-3 rounded-card border border-line bg-surface p-3 text-xs text-ink-3">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-3">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          <span>Rendering diagram</span>
        </div>
        <pre className="mt-2 font-mono text-[12px] text-ink-2 whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  /* Settled but invalid Mermaid syntax from model */
  if (error && !svg) {
    return (
      <div className="pele-diagram my-3 rounded-card border border-line bg-surface p-3 text-xs text-ink">
        <div className="flex items-center justify-between border-b border-line pb-2 text-ink-3">
          <span className="font-mono text-[11px] text-red">Invalid diagram syntax</span>
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            {copied ? <IconCheck size={12} className="text-green" /> : <IconCopy size={12} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
        <pre className="mt-2 font-mono text-[12px] text-ink-2 whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  const lines = code.trim().split("\n");

  return (
    <>
      <figure
        ref={figureRef}
        className="pele-diagram group my-3 overflow-hidden rounded-card border border-line bg-surface"
      >
        {/* Header bar: type + Preview/Code tabs on left; Copy + Fullscreen on right */}
        <div className="flex items-center justify-between border-b border-line/60 bg-inset/40 px-3 py-1.5 text-ink-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
              <IconChartDots size={13} className="text-ink-3" />
              <span className="capitalize">{diagramType ?? "diagram"}</span>
            </div>

            {/* Preview / Code switchable control */}
            <div className="flex items-center rounded-[6px] bg-field p-0.5 shadow-hairline">
              <button
                type="button"
                onClick={() => handleTabChange("preview")}
                className={cn(
                  "flex h-5 items-center rounded-[5px] px-2 text-[11px] font-medium transition-all duration-150",
                  tab === "preview"
                    ? "bg-surface text-ink shadow-btn"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => handleTabChange("code")}
                className={cn(
                  "flex h-5 items-center rounded-[5px] px-2 text-[11px] font-medium transition-all duration-150",
                  tab === "code"
                    ? "bg-surface text-ink shadow-btn"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                Code
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={copied ? "Copied" : "Copy code"}
              onClick={onCopy}
              className={cn(
                "flex h-6 w-[66px] shrink-0 items-center justify-center gap-1.5 rounded-[6px] text-[11px] transition-colors duration-150 hover:bg-hover active:scale-[0.97]",
                copied ? "text-green font-medium" : "text-ink-3 hover:text-ink",
              )}
            >
              <span className="relative flex size-3 shrink-0 items-center justify-center">
                <span
                  aria-hidden={copied}
                  className="absolute inset-0 flex items-center justify-center transition-all duration-200"
                  style={{
                    opacity: copied ? 0 : 1,
                    transform: copied ? "scale(0.8)" : "scale(1)",
                  }}
                >
                  <IconCopy size={12} />
                </span>
                <span
                  aria-hidden={!copied}
                  className="absolute inset-0 flex items-center justify-center text-green transition-all duration-200"
                  style={{
                    opacity: copied ? 1 : 0,
                    transform: copied ? "scale(1)" : "scale(0.8)",
                  }}
                >
                  <IconCheck size={12} stroke={2.4} strokeWidth={2.4} />
                </span>
              </span>

              <span className="relative h-3.5 w-[36px] shrink-0 overflow-hidden text-left">
                <span
                  aria-hidden={copied}
                  className="absolute inset-0 flex items-center transition-all duration-200"
                  style={{
                    opacity: copied ? 0 : 1,
                    transform: copied ? "translateY(-5px)" : "translateY(0)",
                  }}
                >
                  Copy
                </span>
                <span
                  aria-hidden={!copied}
                  className="absolute inset-0 flex items-center text-green font-medium transition-all duration-200"
                  style={{
                    opacity: copied ? 1 : 0,
                    transform: copied ? "translateY(0)" : "translateY(5px)",
                  }}
                >
                  Copied
                </span>
              </span>
            </button>

            <button
              type="button"
              aria-label="Expand diagram to full screen"
              onClick={() => {
                zoomRef.current = 1;
                panRef.current = { x: 0, y: 0 };
                setZoom(1);
                setPan({ x: 0, y: 0 });
                setFullscreen(true);
              }}
              className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink active:scale-[0.97]"
              title="Full screen"
            >
              <IconMaximize size={13} />
            </button>
          </div>
        </div>

        {/* Card Body: Smooth animated height container */}
        <div
          ref={containerRef}
          data-prevent-scroll-pin={isTransitioning ? "true" : undefined}
          style={{
            height: currentHeight !== null ? `${currentHeight}px` : "auto",
            transition: isTransitioning
              ? "height 280ms cubic-bezier(0.23, 1, 0.32, 1)"
              : "none",
          }}
          onTransitionEnd={(e) => {
            if (e.target === containerRef.current && e.propertyName === "height") {
              setIsTransitioning(false);
              setCurrentHeight(null);
            }
          }}
          className="min-h-[140px] overflow-hidden"
        >
          <div
            ref={innerRef}
            key={tab}
            style={{ animation: "fade-in 180ms ease-out both" }}
          >
            {tab === "preview" ? (
              <div
                className="flex items-center justify-center overflow-x-auto p-4 scroll-slim"
                dangerouslySetInnerHTML={{ __html: svg ?? "" }}
              />
            ) : (
              <div className="overflow-x-auto py-3 font-mono text-[12px] leading-[1.65] text-ink-2 bg-field/30 scroll-slim">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-[20px_minmax(0,1fr)] items-start">
                      <span className="select-none text-center text-[10.5px] text-ink-3">{i + 1}</span>
                      <code className="pr-4 pl-2 break-words whitespace-pre-wrap font-mono text-[11.5px] text-ink">
                        {line}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </figure>

      {/* Full screen modal */}
      {fullscreen && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/75 dark:bg-black/85 p-3 sm:p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded diagram view"
          onClick={() => setFullscreen(false)}
        >
          <div
            className="pele-diagram relative flex size-full max-w-6xl flex-col overflow-hidden rounded-window border border-line bg-surface shadow-overlay"
            style={{ animation: "dialog-in 240ms var(--ease-out-strong) both" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3.5 sm:px-4">
              <div className="flex items-center gap-2 text-ink">
                <IconChartDots size={16} className="text-ink-2" />
                <span className="text-[13px] font-semibold capitalize">
                  {diagramType ?? "diagram"}
                </span>
              </div>

              {/* Controls: Zoom In / Zoom Out / Reset + Copy + Close */}
              <div className="flex items-center gap-1.5">
                <div className="flex shrink-0 items-center rounded-[6px] border border-line bg-field p-0.5 shadow-hairline">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={zoom <= 0.5}
                    onClick={() => {
                      const curZoom = zoomRef.current;
                      const curPan = panRef.current;
                      const nextZoom = Math.max(0.5, Math.round((curZoom - 0.25) * 100) / 100);
                      const ratio = nextZoom / curZoom;
                      const nextPan = { x: curPan.x * ratio, y: curPan.y * ratio };
                      zoomRef.current = nextZoom;
                      panRef.current = nextPan;
                      setZoom(nextZoom);
                      setPan(nextPan);
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                    title="Zoom out"
                  >
                    <IconZoomOut size={13} />
                  </button>

                  <button
                    type="button"
                    aria-label="Reset zoom and position"
                    onClick={() => {
                      zoomRef.current = 1;
                      panRef.current = { x: 0, y: 0 };
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="flex h-6 w-12 shrink-0 items-center justify-center rounded-[5px] px-1 font-mono text-[11px] tabular-nums text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                    title="Reset view (or double-click canvas)"
                  >
                    {Math.round(zoom * 100)}%
                  </button>

                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={zoom >= 5}
                    onClick={() => {
                      const curZoom = zoomRef.current;
                      const curPan = panRef.current;
                      const nextZoom = Math.min(5, Math.round((curZoom + 0.25) * 100) / 100);
                      const ratio = nextZoom / curZoom;
                      const nextPan = { x: curPan.x * ratio, y: curPan.y * ratio };
                      zoomRef.current = nextZoom;
                      panRef.current = nextPan;
                      setZoom(nextZoom);
                      setPan(nextPan);
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                    title="Zoom in"
                  >
                    <IconZoomIn size={13} />
                  </button>
                </div>

                <div className="mx-1 h-3.5 w-px shrink-0 bg-line" />

                {/* Fixed-width copy button prevents layout shifting the zoom controls */}
                <button
                  type="button"
                  aria-label={copied ? "Copied" : "Copy code"}
                  onClick={onCopy}
                  className={cn(
                    "flex h-7 w-[74px] shrink-0 items-center justify-center gap-1.5 rounded-[7px] text-[12px] transition-colors duration-150 hover:bg-hover active:scale-[0.97]",
                    copied ? "text-green font-medium" : "text-ink-3 hover:text-ink",
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
                      <IconCopy size={13} />
                    </span>
                    <span
                      aria-hidden={!copied}
                      className="absolute inset-0 flex items-center justify-center text-green transition-all duration-200"
                      style={{
                        opacity: copied ? 1 : 0,
                        transform: copied ? "scale(1)" : "scale(0.8)",
                      }}
                    >
                      <IconCheck size={13} stroke={2.4} strokeWidth={2.4} />
                    </span>
                  </span>

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

                <button
                  type="button"
                  aria-label="Close full screen"
                  onClick={() => setFullscreen(false)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                  title="Close"
                >
                  <IconX size={15} />
                </button>
              </div>
            </div>

            {/* Modal Body: Infinite 2D Pan & Zoom canvas */}
            <div
              ref={canvasRef}
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden select-none bg-canvas/30"
              style={{
                cursor: isPanning ? "grabbing" : "grab",
                touchAction: "none",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={() => {
                zoomRef.current = 1;
                panRef.current = { x: 0, y: 0 };
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <div
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: isPanning || isWheeling
                    ? "none"
                    : "transform 150ms cubic-bezier(0.23, 1, 0.32, 1)",
                  willChange: "transform",
                }}
                className="pointer-events-none flex items-center justify-center max-w-full max-h-full [&_svg]:max-w-none [&_svg]:max-h-none"
                dangerouslySetInnerHTML={{ __html: svg ?? "" }}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
