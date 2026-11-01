"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import {
  IconCheck,
  IconCopy,
  IconPencil,
  IconRefresh,
  IconShare2,
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
} from "@tabler/icons-react";

/** Brand blue extracted from /public/myntle-logo.svg */
const MYNTLE_BLUE = "#00A6FF";

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
  stroke?: number;
  style?: CSSProperties;
};

/* ─────────────────────────────────────────────────────────
 * EMIL KOWALSKI TOOLTIP COORDINATOR
 *
 * "Tooltips should delay before appearing to prevent accidental
 * activation. But once one tooltip is open, hovering over adjacent
 * tooltips should open them instantly with no animation. This feels
 * faster without defeating the purpose of the initial delay."
 *
 * - Cold hover: waits 400ms delay, then smoothly animates in (pop-in 125ms).
 * - Warm window: once any tooltip is active, adjacent tooltips open with
 *   0ms delay and 0ms animation duration.
 * - Cool-down: after mouse leaves for 400ms, reverts back to cold.
 * ───────────────────────────────────────────────────────── */

export let globalIsWarm = false;
export let globalWarmTimer: ReturnType<typeof setTimeout> | null = null;

export function onTooltipEnter() {
  if (globalWarmTimer) {
    clearTimeout(globalWarmTimer);
    globalWarmTimer = null;
  }
}

export function onTooltipLeave() {
  if (globalWarmTimer) clearTimeout(globalWarmTimer);
  globalWarmTimer = setTimeout(() => {
    globalIsWarm = false;
  }, 400);
}

export function activateWarmState() {
  globalIsWarm = true;
  if (globalWarmTimer) {
    clearTimeout(globalWarmTimer);
    globalWarmTimer = null;
  }
}

export function isTooltipWarm() {
  return globalIsWarm;
}

/**
 * An action icon button with an Emil Kowalski-crafted hover tooltip.
 */
export function MessageActionButton({
  icon: Icon,
  activeIcon: ActiveIcon,
  label,
  activeLabel,
  active = false,
  onClick,
  ariaLabel,
  disabled = false,
  activeColor,
  iconStroke = 1.8,
  activeIconStroke = 2.6,
}: {
  icon: ComponentType<IconProps>;
  activeIcon?: ComponentType<IconProps>;
  label: string;
  activeLabel?: string;
  active?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  activeColor?: string;
  iconStroke?: number;
  activeIconStroke?: number;
}) {
  const currentLabel = active && activeLabel ? activeLabel : label;

  const [isOpen, setIsOpen] = useState(false);
  const [isInstant, setIsInstant] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    onTooltipEnter();
    if (globalIsWarm) {
      // Warm: skip delay and skip entrance animation
      setIsInstant(true);
      setIsOpen(true);
    } else {
      // Cold: delay to prevent accidental activation on cursor sweep
      setIsInstant(false);
      openTimerRef.current = setTimeout(() => {
        setIsOpen(true);
        activateWarmState();
      }, 400);
    }
  };

  const handleMouseLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    setIsOpen(false);
    onTooltipLeave();
  };

  const handleFocus = () => {
    setIsInstant(false);
    setIsOpen(true);
    activateWarmState();
  };

  const handleBlur = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    setIsOpen(false);
    onTooltipLeave();
  };

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-label={ariaLabel || currentLabel}
        className={`flex size-7 items-center justify-center rounded-[6px] transition-[background-color,color,transform] duration-150 ease-out outline-none
          hover:bg-hover-2 hover:text-ink active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40
          ${active ? (activeColor ? "" : "text-ink") : "text-ink-3"}`}
      >
        {ActiveIcon ? (
          <span className="relative flex size-4 items-center justify-center">
            <span
              aria-hidden={active}
              className="absolute inset-0 flex items-center justify-center text-current"
              style={{
                opacity: active ? 0 : 1,
                filter: active ? "blur(2.5px)" : "blur(0px)",
                transform: active ? "scale(0.85)" : "scale(1)",
                pointerEvents: active ? "none" : "auto",
                transition:
                  "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
                willChange: "transform, opacity, filter",
              }}
            >
              <Icon
                size={14.5}
                stroke={iconStroke}
                strokeWidth={iconStroke}
              />
            </span>
            <span
              aria-hidden={!active}
              className={`absolute inset-0 flex items-center justify-center ${
                !activeColor ? "text-green" : ""
              }`}
              style={{
                opacity: active ? 1 : 0,
                filter: active ? "blur(0px)" : "blur(2.5px)",
                transform: active ? "scale(1)" : "scale(0.85)",
                pointerEvents: active ? "auto" : "none",
                transition:
                  "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
                willChange: "transform, opacity, filter",
                ...(activeColor ? { color: activeColor } : {}),
              }}
            >
              <ActiveIcon
                size={14.5}
                stroke={activeIconStroke}
                strokeWidth={activeIconStroke}
              />
            </span>
          </span>
        ) : (
          <Icon
            size={14.5}
            stroke={iconStroke}
            strokeWidth={iconStroke}
            className="text-current"
          />
        )}
      </button>

      {/* Floating tooltip — styled after the pill design (rounded-full, bg-inset, shadow-hairline) */}
      {isOpen && (
        <div
          role="tooltip"
          data-instant={isInstant ? "" : undefined}
          className={`pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-30 inline-flex h-5.5 items-center justify-center whitespace-nowrap rounded-full bg-inset px-2.5 text-[11.5px] font-medium shadow-hairline origin-bottom
            ${active && !activeColor && ActiveIcon ? "text-green" : "text-ink dark:text-white"}`}
          style={
            isInstant
              ? { transition: "none", animation: "none" }
              : {
                  animation:
                    "pop-in 125ms cubic-bezier(0.23, 1, 0.32, 1) both",
                }
          }
        >
          {currentLabel}
        </div>
      )}
    </div>
  );
}

/**
 * Options bar for user messages.
 * Only appears when hovering over the message turn.
 */
export function UserMessageActions({
  text,
  onEdit,
  className = "",
}: {
  text: string;
  onEdit?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }, [text]);

  const handleShare = useCallback(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      navigator.share({ text }).catch(() => {});
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setShared(true);
          if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
          shareTimerRef.current = setTimeout(() => setShared(false), 1800);
        })
        .catch(() => {});
    }
  }, [text]);

  return (
    <div
      className={`flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 ${className}`}
    >
      <MessageActionButton
        icon={IconCopy}
        activeIcon={IconCheck}
        label="Copy"
        activeLabel="Copied!"
        active={copied}
        onClick={handleCopy}
      />
      <MessageActionButton
        icon={IconShare2}
        activeIcon={IconCheck}
        label="Share"
        activeLabel="Shared!"
        active={shared}
        onClick={handleShare}
      />
      {onEdit && (
        <MessageActionButton
          icon={IconPencil}
          label="Edit"
          onClick={onEdit}
        />
      )}
    </div>
  );
}

/**
 * Options bar for generated chat response (assistant messages).
 * ALWAYS PRESENT below the message response (not conditional on hover).
 */
export function AgentMessageActions({
  text,
  onRegenerate,
  className = "",
}: {
  text: string;
  onRegenerate?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }, [text]);

  const handleShare = useCallback(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      navigator.share({ text }).catch(() => {});
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setShared(true);
          if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
          shareTimerRef.current = setTimeout(() => setShared(false), 1800);
        })
        .catch(() => {});
    }
  }, [text]);

  const toggleRating = useCallback((choice: "like" | "dislike") => {
    setRating((current) => (current === choice ? null : choice));
  }, []);

  return (
    <div className={`flex items-center gap-0.5 text-ink-3 opacity-100 ${className}`}>
      <MessageActionButton
        icon={IconCopy}
        activeIcon={IconCheck}
        label="Copy"
        activeLabel="Copied!"
        active={copied}
        onClick={handleCopy}
      />
      {onRegenerate && (
        <MessageActionButton
          icon={IconRefresh}
          label="Retry"
          onClick={onRegenerate}
        />
      )}
      <MessageActionButton
        icon={IconThumbUp}
        activeIcon={IconThumbUpFilled}
        label="Good"
        active={rating === "like"}
        activeColor={MYNTLE_BLUE}
        onClick={() => toggleRating("like")}
      />
      <MessageActionButton
        icon={IconThumbDown}
        activeIcon={IconThumbDownFilled}
        label="Bad"
        active={rating === "dislike"}
        activeColor={MYNTLE_BLUE}
        onClick={() => toggleRating("dislike")}
      />
      <MessageActionButton
        icon={IconShare2}
        activeIcon={IconCheck}
        label="Share"
        activeLabel="Shared!"
        active={shared}
        onClick={handleShare}
      />
    </div>
  );
}

/**
 * Upgraded UserBubble with inline editing and hover action bar.
 */
export function UserBubble({
  text,
  onEdit,
  className = "",
}: {
  text: string;
  onEdit?: (nextText: string) => void;
  className?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(text);
  }, [text]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(draft.length, draft.length);
    }
  }, [isEditing, draft.length]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setDraft(text);
  }, [text]);

  const handleSubmit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setIsEditing(false);
    if (trimmed !== text) {
      onEdit?.(trimmed);
    }
  }, [draft, text, onEdit]);

  if (isEditing) {
    return (
      <div
        className={`flex justify-end pl-10 sm:pl-24 ${className}`}
        style={{ animation: "fade-up 240ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <div className="w-full max-w-[620px] rounded-xl border border-line-strong bg-surface p-3 shadow-card">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              } else if (e.key === "Escape") {
                handleCancel();
              }
            }}
            rows={Math.max(2, Math.min(8, draft.split("\n").length))}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none"
          />
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-control px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!draft.trim()}
              className="rounded-control bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white transition-opacity duration-100 hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex flex-col items-end pl-10 sm:pl-24 ${className}`}
      style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <div className="rounded-xl bg-field px-3.5 py-2 text-[13px] leading-relaxed text-ink shadow-hairline">
        {text}
      </div>
      <div className="mt-1 flex justify-end">
        <UserMessageActions
          text={text}
          onEdit={onEdit ? () => setIsEditing(true) : undefined}
        />
      </div>
    </div>
  );
}
