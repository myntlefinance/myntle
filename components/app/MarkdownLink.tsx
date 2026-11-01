"use client";

import {
  useCallback,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconCopy,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { cn } from "@/lib/utils";

export function ExternalLinkDialog({
  url,
  onClose,
  onConfirm,
}: {
  url: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Ignore clipboard failures.
    }
  }, [url]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label="External Resource"
    >
      <div
        className="absolute inset-0 bg-black/60 dark:bg-black/75"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={onClose}
      />
      <div
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-window border border-line bg-surface shadow-overlay"
        style={{ animation: "dialog-in 240ms var(--ease-out-strong) both" }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between pl-4 pr-2.5">
          <div className="flex items-center gap-2 text-ink">
            <IconWorld size={16} className="text-ink-2" />
            <span className="text-[13px] font-semibold">External Resource</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <IconX size={15} />
          </button>
        </div>

        <div className="px-4 pb-4 pt-1">
          <p className="text-[13px] leading-relaxed text-ink-2">
            You are about to visit an external website. Make sure you trust the destination before proceeding.
          </p>
          <div className="mt-3 overflow-hidden rounded-control border border-line bg-field px-3 py-2 shadow-hairline">
            <span className="break-all text-[13px] leading-relaxed text-[#00A6FF] select-all">
              {url}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between bg-surface px-4 pb-3.5 pt-0">
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={copy}
            className={cn(
              "px-2.5 text-[12.5px] transition-colors duration-150",
              copied ? "text-green font-medium" : "text-ink-3 hover:text-ink",
            )}
          >
            {copied ? (
              <IconCheck size={14} stroke={2.4} strokeWidth={2.4} className="text-green" />
            ) : (
              <IconCopy size={14} />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </Button>

          <div className="-mr-0.5 flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              className="px-2.5 text-[12.5px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={onConfirm}
              className="text-[12.5px]"
            >
              Open
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MarkdownLink({
  href,
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Incomplete streamdown links while streaming.
  if (href === "streamdown:incomplete-link") {
    return (
      <span className={cn("text-ink-3 underline decoration-dotted", className)}>
        {children}
      </span>
    );
  }

  const linkClasses =
    "font-medium text-[#00A6FF] underline decoration-[#00A6FF]/35 underline-offset-4 transition-colors hover:text-[#0092e0] dark:hover:text-[#38bdf8] hover:decoration-[#00A6FF]";

  // Anchor and footnote reference links: smooth scroll in-page without modals or new tabs.
  if (href?.startsWith("#")) {
    return (
      <a
        href={href}
        className={cn(linkClasses, className)}
        onClick={(e) => {
          e.preventDefault();
          const targetId = href.slice(1);
          const decodedId = decodeURIComponent(targetId);
          const targetEl =
            document.getElementById(decodedId) ||
            document.getElementById(targetId) ||
            document.querySelector(`[name="${CSS.escape(targetId)}"]`);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }}
        {...props}
      >
        {children}
      </a>
    );
  }

  // Internal relative links.
  if (href?.startsWith("/")) {
    return (
      <a
        href={href}
        className={cn(linkClasses, className)}
        {...props}
      >
        {children}
      </a>
    );
  }

  // External URLs.
  const isExternal = Boolean(href && /^https?:\/\//i.test(href));

  return (
    <>
      <a
        href={href}
        className={cn(
          "cursor-pointer",
          linkClasses,
          className,
        )}
        onClick={(e) => {
          if (isExternal) {
            e.preventDefault();
            setModalOpen(true);
          }
        }}
        rel={isExternal ? "noopener noreferrer" : undefined}
        {...props}
      >
        {children}
      </a>

      {isExternal && modalOpen && mounted && href && (
        <ExternalLinkDialog
          url={href}
          onClose={() => setModalOpen(false)}
          onConfirm={() => {
            window.open(href, "_blank", "noopener,noreferrer");
            setModalOpen(false);
          }}
        />
      )}
    </>
  );
}
