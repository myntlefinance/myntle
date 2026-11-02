/**
 * Desktop composer activation & focus management.
 *
 * Rules:
 * - Desktop only: Automatically activates composer on "New chat" and when typing begins.
 * - Mobile exclusion: Mobile/tablet devices must NEVER auto-focus to prevent virtual keyboard popups.
 * - Idempotent & non-intrusive: Does not steal focus when user is interacting with inputs, modals, or menus.
 */

export const FOCUS_COMPOSER_EVENT = "myntle:focus-composer";

export type FocusComposerDetail = {
  clearDraft?: boolean;
};

/**
 * Detects whether the current device is a desktop with a physical keyboard.
 * Excludes mobile devices (smartphones, tablets, touch-first devices) so that
 * programmatically focusing an input never pops up the on-screen virtual keyboard.
 */
export function isDesktop(
  customWindow?: Window,
  customNavigator?: Navigator,
): boolean {
  const win = customWindow ?? (typeof window !== "undefined" ? window : undefined);
  const nav = customNavigator ?? (typeof navigator !== "undefined" ? navigator : undefined);

  if (!win || !nav) {
    return false;
  }

  // 1. Check user agent for mobile/tablet devices
  const ua = nav.userAgent || "";
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return false;
  }

  // 2. Detect iPadOS masquerading as MacIntel with touch support
  if (nav.platform === "MacIntel" && nav.maxTouchPoints > 1) {
    return false;
  }

  // 3. Media query inspection for coarse-only pointers or devices without hover
  if (typeof win.matchMedia === "function") {
    const hasFinePointer = win.matchMedia("(pointer: fine)").matches;
    const canHover = win.matchMedia("(hover: hover)").matches;
    const isCoarseOnly = win.matchMedia("(pointer: coarse)").matches && !hasFinePointer;

    if (isCoarseOnly || (!canHover && !hasFinePointer)) {
      return false;
    }
  }

  return true;
}

/**
 * Returns true if the element is an editable text field, textarea, contenteditable,
 * or interactive control where keystrokes belong to that element.
 */
export function isEditableElement(el: Element | null): boolean {
  if (!el || typeof el !== "object") return false;

  const tag = (el.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "select") return true;

  if (tag === "input") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
  }

  if (Boolean((el as HTMLElement).isContentEditable)) return true;

  return false;
}

/**
 * Dispatches a request to focus the active composer on desktop.
 * On mobile, this is a no-op to avoid popping up the on-screen keyboard.
 */
export function focusComposer(options?: FocusComposerDetail): void {
  if (typeof window === "undefined" || !isDesktop()) return;

  window.dispatchEvent(
    new CustomEvent<FocusComposerDetail>(FOCUS_COMPOSER_EVENT, {
      detail: options,
    }),
  );
}

/**
 * Focuses the composer textarea, inserts the typed character at the current selection/end,
 * dispatches the input event to trigger React's synthetic change tracker, and positions
 * the cursor immediately after the inserted character.
 */
export function typeToFocusComposer(
  input: HTMLTextAreaElement,
  char: string,
  onValueChange?: (val: string) => void,
): void {
  input.focus();

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const prev = input.value;
  const next = prev.slice(0, start) + char + prev.slice(end);
  const nextPos = start + char.length;

  const proto =
    typeof window !== "undefined"
      ? window.HTMLTextAreaElement?.prototype
      : undefined;
  const nativeSetter = proto
    ? Object.getOwnPropertyDescriptor(proto, "value")?.set
    : undefined;

  if (nativeSetter) {
    nativeSetter.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    input.value = next;
    onValueChange?.(next);
  }

  input.setSelectionRange(nextPos, nextPos);
}
